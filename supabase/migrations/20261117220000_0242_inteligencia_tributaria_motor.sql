-- 0242 — Inteligência Tributária: motor de consulta em massa (Fase 2)
-- ============================================================================
-- NÃO APLICADA. Depende da 0240 e da 0241. Só entra no Supabase com autorização
-- expressa do usuário.
--
-- O executor (scripts/tax-intel/executor) baixa os arquivos públicos da Receita,
-- cruza em fluxo com os CNPJs de todas as carteiras e grava SÓ as linhas casadas
-- pelas funções tax_ingest_* abaixo. Ele conecta com o papel próprio
-- `tax_ingestor`, que não tem privilégio em tabela nenhuma.
--
-- Garantias deste arquivo:
--   * Cada função confere session_user = 'tax_ingestor' e a execução aberta.
--   * Só entra chave (CNPJ ou raiz) que está em alguma carteira; o executor não
--     recebe tenant, nome declarado nem tipo de relacionamento.
--   * Idempotente: (fonte, competência, chave) grava uma vez só (índice único
--     da 0240). Repetir um lote não duplica nada: é a retomada.
--   * Classificação pública: NÃO optar pelo Simples nunca vira Presumido nem Real.
--     Real/Presumido só com ECF declarada, com o ano ao lado, e só se a ECF for
--     posterior à última saída do Simples.
--   * Não usa regime_from_registry / cnpj_registry / counterparties.regime.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Papel do executor
-- ---------------------------------------------------------------------------
-- NOLOGIN aqui: habilitar o login e definir a senha é um passo manual, fora do
-- repositório (a senha nunca vai para o Git). Ver docs/inteligencia-tributaria/motor.md.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tax_ingestor') then
    create role tax_ingestor nologin noinherit nocreatedb nocreaterole nobypassrls;
  end if;
end $$;
grant usage on schema public to tax_ingestor;
alter role tax_ingestor set statement_timeout = '120s';
alter role tax_ingestor set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 2. Execução
-- ---------------------------------------------------------------------------
create or replace function public.tax_ingest_guard(p_run uuid)
returns public.tax_source_runs
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v tax_source_runs;
begin
  if session_user <> 'tax_ingestor' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v from tax_source_runs where id = p_run;
  if v.id is null then raise exception 'execução inexistente' using errcode = '22023'; end if;
  if v.status <> 'iniciada' then
    raise exception 'execução não está aberta (status: %)', v.status using errcode = '22023';
  end if;
  return v;
end $$;

create or replace function public.tax_ingest_start_run(
  p_competencia text, p_datasets text[], p_triggered_by text, p_github_run_url text default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_id uuid; v_targets int; v_roots int;
begin
  if session_user <> 'tax_ingestor' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_datasets is null or not (p_datasets <@ array['receita_simples', 'receita_estabelecimentos',
       'receita_empresas', 'receita_regime_tributario']) then
    raise exception 'conjunto de dados inválido' using errcode = '22023';
  end if;
  -- Uma execução aberta por vez. Se a aberta é da mesma competência, é retomada:
  -- devolve o mesmo id, e cada arquivo continua da última linha gravada.
  select id into v_id from tax_source_runs where status = 'iniciada' order by started_at desc limit 1;
  if v_id is not null then
    if not exists (select 1 from tax_source_runs where id = v_id and competencia = p_competencia
                     and datasets @> p_datasets and p_datasets @> datasets) then
      raise exception 'já existe uma execução aberta de outra competência ou conjunto (%)', v_id using errcode = '22023';
    end if;
    select count(distinct cnpj), count(distinct cnpj_raiz) into v_targets, v_roots from tax_relationships;
    return jsonb_build_object('run_id', v_id, 'targets', v_targets, 'roots', v_roots, 'retomada', true);
  end if;
  insert into tax_source_runs (competencia, datasets, dry_run, triggered_by, github_run_url)
  values (p_competencia, p_datasets, false, left(p_triggered_by, 100), p_github_run_url)
  returning id into v_id;
  select count(distinct cnpj), count(distinct cnpj_raiz) into v_targets, v_roots from tax_relationships;
  update tax_source_runs set targets_count = v_targets where id = v_id;
  return jsonb_build_object('run_id', v_id, 'targets', v_targets, 'roots', v_roots, 'retomada', false);
end $$;

-- Lista de CNPJs-alvo: distintos, sem tenant, sem nome, sem relacionamento.
-- Paginada por chave para caber no limite de tempo.
create or replace function public.tax_ingest_targets(p_run uuid, p_after text default null, p_limit int default 20000)
returns table (cnpj text)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform tax_ingest_guard(p_run);
  return query
    select distinct r.cnpj::text from tax_relationships r
     where p_after is null or r.cnpj::text > p_after
     order by 1 limit least(greatest(p_limit, 1), 50000);
end $$;

-- Progresso por arquivo (retomada): devolve a última linha já gravada.
create or replace function public.tax_ingest_file(
  p_run uuid, p_file_name text, p_size bigint, p_sha256 text, p_header text[],
  p_rows_scanned bigint, p_rows_matched bigint, p_last_row bigint, p_status text)
returns bigint
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_last bigint;
begin
  perform tax_ingest_guard(p_run);
  insert into tax_source_run_files (run_id, file_name, size_bytes, sha256, header, rows_scanned,
                                    rows_matched, last_row_committed, status, updated_at)
  values (p_run, p_file_name, p_size, p_sha256, p_header, coalesce(p_rows_scanned, 0),
          coalesce(p_rows_matched, 0), coalesce(p_last_row, 0), p_status, now())
  on conflict (run_id, file_name) do update set
    size_bytes = coalesce(excluded.size_bytes, tax_source_run_files.size_bytes),
    sha256 = coalesce(excluded.sha256, tax_source_run_files.sha256),
    header = coalesce(excluded.header, tax_source_run_files.header),
    rows_scanned = greatest(excluded.rows_scanned, tax_source_run_files.rows_scanned),
    rows_matched = greatest(excluded.rows_matched, tax_source_run_files.rows_matched),
    last_row_committed = greatest(excluded.last_row_committed, tax_source_run_files.last_row_committed),
    status = excluded.status,
    updated_at = now()
  returning last_row_committed into v_last;
  return v_last;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Gravação das linhas casadas (lote de até 1.000)
-- ---------------------------------------------------------------------------
-- p_rows: [{"key": "...", "status": "ok"|"nao_encontrado", "raw": {...}, "n": {...}}]
--   receita_simples           key = raiz;  n = {opcao_simples, data_opcao_simples,
--                             data_exclusao_simples, opcao_mei, data_opcao_mei, data_exclusao_mei}
--   receita_empresas          key = raiz;  n = {razao_social, natureza_juridica, porte}
--   receita_estabelecimentos  key = CNPJ;  n = {nome_fantasia, situacao_cadastral, situacao_data, uf, municipio}
--   receita_regime_tributario key = CNPJ;  n = {linhas: [{ano, forma, cnpj_da_scp, quantidade}]}
create or replace function public.tax_ingest_batch(p_run uuid, p_source text, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_run tax_source_runs;
  v_gran tax_granularity;
  v_n int;
  v_bad int;
  v_inserted int;
begin
  v_run := tax_ingest_guard(p_run);
  if not (p_source = any (v_run.datasets)) then
    raise exception 'fonte % não faz parte desta execução', p_source using errcode = '22023';
  end if;
  v_gran := case when p_source in ('receita_simples', 'receita_empresas') then 'raiz'
                 else 'estabelecimento' end::tax_granularity;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'lote inválido' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n not between 1 and 1000 or octet_length(p_rows::text) > 4000000 then
    raise exception 'lote inválido: 1 a 1.000 linhas e até 4 MB' using errcode = '22023';
  end if;

  -- Formato, granularidade e pertença à carteira: um erro recusa o lote inteiro.
  select count(*) into v_bad
    from jsonb_array_elements(p_rows) e
   where case
           when jsonb_typeof(e) <> 'object' then true
           when jsonb_typeof(e->'key') is distinct from 'string' then true
           when (e->>'status') not in ('ok', 'nao_encontrado') or e->>'status' is null then true
           when v_gran = 'raiz' and (e->>'key') !~ '^[0-9A-Z]{8}$' then true
           when v_gran = 'estabelecimento' and not tax_cnpj_is_valid(e->>'key') then true
           when (e->>'status') = 'ok' and jsonb_typeof(e->'n') is distinct from 'object' then true
           when v_gran = 'raiz' and not exists (select 1 from tax_relationships r where r.cnpj_raiz = e->>'key') then true
           when v_gran = 'estabelecimento' and not exists (select 1 from tax_relationships r where r.cnpj = e->>'key') then true
           else false
         end;
  if v_bad > 0 then
    raise exception 'lote inválido: % linha(s) fora do formato ou fora das carteiras', v_bad using errcode = '22023';
  end if;
  select count(*) - count(distinct e->>'key') into v_bad from jsonb_array_elements(p_rows) e;
  if v_bad > 0 then raise exception 'lote inválido: chave repetida' using errcode = '22023'; end if;

  create temporary table if not exists tmp_ingest (
    key text, status tax_consultation_status, raw jsonb, n jsonb, consultation_id uuid, novo boolean
  ) on commit drop;
  truncate tmp_ingest;
  insert into tmp_ingest (key, status, raw, n)
  select e->>'key', (e->>'status')::tax_consultation_status, e->'raw', e->'n'
    from jsonb_array_elements(p_rows) e;

  -- Consulta (imutável). Já existente na mesma competência = cache: não grava de novo.
  with ins as (
    insert into tax_consultations (source_code, dataset_version, lookup_key, granularity, status,
                                   response_raw, response_normalized, response_sha256, source_run_id)
    select p_source, v_run.competencia, t.key, v_gran, t.status, t.raw, t.n,
           case when t.raw is not null then encode(digest(t.raw::text, 'sha256'), 'hex') end, p_run
      from tmp_ingest t
    on conflict (source_code, dataset_version, lookup_key) where dataset_version is not null do nothing
    returning id, lookup_key
  )
  update tmp_ingest t set consultation_id = ins.id, novo = true from ins where ins.lookup_key = t.key;
  get diagnostics v_inserted = row_count;

  -- Efeitos só das consultas novas e "ok".
  if p_source = 'receita_simples' then
    insert into tax_regimes (regime, lookup_key, granularity, start_date, end_date, consultation_id)
    select x.regime::tax_public_regime, t.key, 'raiz', x.ini, x.fim, t.consultation_id
      from tmp_ingest t
      cross join lateral (values
        ('simples_nacional', nullif(t.n->>'data_opcao_simples', '')::date, nullif(t.n->>'data_exclusao_simples', '')::date),
        ('simei', nullif(t.n->>'data_opcao_mei', '')::date, nullif(t.n->>'data_exclusao_mei', '')::date)
      ) as x(regime, ini, fim)
     where t.novo and t.status = 'ok' and x.ini is not null and (x.fim is null or x.fim >= x.ini)
    on conflict (regime, lookup_key, start_date) do update set end_date = excluded.end_date
      where tax_regimes.end_date is null and excluded.end_date is not null;

  elsif p_source = 'receita_empresas' then
    update tax_entities e set razao_social = left(t.n->>'razao_social', 300), updated_at = now()
      from tmp_ingest t
     where t.novo and t.status = 'ok' and e.cnpj_raiz = t.key
       and e.razao_social is distinct from left(t.n->>'razao_social', 300);

  elsif p_source = 'receita_estabelecimentos' then
    update tax_entities e set
      nome_fantasia = left(nullif(t.n->>'nome_fantasia', ''), 300),
      situacao_cadastral = left(nullif(t.n->>'situacao_cadastral', ''), 60),
      situacao_data = nullif(t.n->>'situacao_data', '')::date,
      uf = case when t.n->>'uf' ~ '^[A-Z]{2}$' then t.n->>'uf' end,
      municipio = left(nullif(t.n->>'municipio', ''), 120),
      updated_at = now()
      from tmp_ingest t
     where t.novo and t.status = 'ok' and e.cnpj = t.key;

  elsif p_source = 'receita_regime_tributario' then
    insert into tax_regime_history (cnpj, ano, forma_tributacao_original, regime_normalizado, cnpj_da_scp,
                                    quantidade_escrituracoes, dataset_version, consultation_id)
    select t.key, (l->>'ano')::smallint, left(l->>'forma', 200),
           tax_normalize_ecf(l->>'forma'), nullif(left(l->>'cnpj_da_scp', 20), ''),
           nullif(l->>'quantidade', '')::int, v_run.competencia, t.consultation_id
      from tmp_ingest t
      cross join lateral jsonb_array_elements(t.n->'linhas') l
     where t.novo and t.status = 'ok' and (l->>'ano') ~ '^[0-9]{4}$' and length(coalesce(l->>'forma', '')) > 0
    on conflict do nothing;
  end if;

  update tax_entities e set last_consulted_at = now()
    from tmp_ingest t
   where t.novo and ((v_gran = 'raiz' and e.cnpj_raiz = t.key) or (v_gran = 'estabelecimento' and e.cnpj = t.key));

  return jsonb_build_object('received', v_n, 'inserted', v_inserted, 'cached', v_n - v_inserted);
end $$;

-- Forma de tributação da ECF (texto original preservado em forma_tributacao_original).
create or replace function public.tax_normalize_ecf(p text)
returns public.tax_ecf_regime
language sql immutable parallel safe
set search_path = public, pg_temp
as $$
  select case
    when v ~ 'ARBITRADO' and v !~ '(REAL|PRESUMIDO)' then 'lucro_arbitrado'
    when v ~ '^LUCRO REAL$|^REAL$' then 'lucro_real'
    when v ~ '^LUCRO PRESUMIDO$|^PRESUMIDO$' then 'lucro_presumido'
    when v ~ 'IMUNE' and v !~ 'ISENT' then 'imune'
    when v ~ 'ISENT' and v !~ 'IMUNE' then 'isenta'
    when v ~ '(REAL|PRESUMIDO|ARBITRADO|IMUNE|ISENT).*(/|E |,).*(REAL|PRESUMIDO|ARBITRADO|IMUNE|ISENT)' then 'combinado'
    else 'nao_mapeado'
  end::tax_ecf_regime
  from (select upper(btrim(translate(coalesce(p, ''), 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooouc' || 'AAAAEEIOOOUC'))) v) x;
$$;

-- ---------------------------------------------------------------------------
-- 4. Classificação pública (trechos, para caber no limite de tempo)
-- ---------------------------------------------------------------------------
-- Regra, na ordem:
--   1. Sem cruzamento com o arquivo do Simples           → consulta_pendente
--   2. SIMEI ativo na competência mais recente            → mei_simei
--   3. Simples ativo                                      → simples_nacional
--   4. ECF declarada depois da última saída do Simples,
--      ano mais recente com uma só forma Real/Presumido  → lucro_real / lucro_presumido (histórico, com ano)
--   5. Teve Simples e saiu (sem ECF posterior que decida) → excluido_simples
--   6. Resto                                              → nao_identificado
-- A ausência de opção pelo Simples NUNCA leva a 4 sem ECF.
create or replace function public.tax_classify_compute(p_cnpj text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_raiz text := substr(p_cnpj, 1, 8);
  s tax_consultations;
  v_mei boolean; v_sn boolean; v_saida date; v_teve boolean;
  e record;
  v_ecf_seen boolean;
begin
  select * into s from tax_consultations
   where source_code = 'receita_simples' and lookup_key = v_raiz and dataset_version is not null
   order by dataset_version desc, consulted_at desc limit 1;
  if s.id is null then
    return jsonb_build_object('classe', 'consulta_pendente',
      'base', jsonb_build_object('motivo', 'CNPJ ainda não cruzado com o arquivo do Simples da Receita'));
  end if;

  v_mei := s.status = 'ok' and s.response_normalized->>'opcao_mei' = 'S'
           and nullif(s.response_normalized->>'data_exclusao_mei', '') is null;
  v_sn  := s.status = 'ok' and s.response_normalized->>'opcao_simples' = 'S'
           and nullif(s.response_normalized->>'data_exclusao_simples', '') is null;
  v_teve := s.status = 'ok' and (nullif(s.response_normalized->>'data_opcao_simples', '') is not null
                                 or nullif(s.response_normalized->>'data_opcao_mei', '') is not null);
  v_saida := greatest(nullif(s.response_normalized->>'data_exclusao_simples', '')::date,
                      nullif(s.response_normalized->>'data_exclusao_mei', '')::date);

  if v_mei then
    return jsonb_build_object('classe', 'mei_simei', 'consulta', s.id, 'base', jsonb_build_object(
      'fonte', s.source_code, 'competencia', s.dataset_version,
      'data_opcao_mei', s.response_normalized->>'data_opcao_mei',
      'data_opcao_simples', s.response_normalized->>'data_opcao_simples'));
  end if;
  if v_sn then
    return jsonb_build_object('classe', 'simples_nacional', 'consulta', s.id, 'base', jsonb_build_object(
      'fonte', s.source_code, 'competencia', s.dataset_version,
      'data_opcao_simples', s.response_normalized->>'data_opcao_simples'));
  end if;

  v_ecf_seen := exists (select 1 from tax_consultations c
                         where c.source_code = 'receita_regime_tributario'
                           and c.lookup_key in (select r.cnpj from tax_relationships r where r.cnpj_raiz = v_raiz
                                                union select p_cnpj));

  -- ECF por raiz: a escrituração é da empresa (matriz), vale para as filiais.
  select h.ano, array_agg(distinct h.regime_normalizado) regs,
         array_agg(distinct h.forma_tributacao_original) formas,
         max(h.dataset_version) versao, (array_agg(h.consultation_id))[1] cid
    into e
    from tax_regime_history h
   where h.cnpj_raiz = v_raiz and (v_saida is null or h.ano > extract(year from v_saida))
   group by h.ano order by h.ano desc limit 1;

  if e.ano is not null and cardinality(e.regs) = 1 and e.regs[1] in ('lucro_real', 'lucro_presumido') then
    return jsonb_build_object('classe', e.regs[1]::text, 'consulta', e.cid, 'base', jsonb_build_object(
      'fonte', 'receita_regime_tributario', 'competencia', e.versao, 'ano_calendario', e.ano,
      'forma_original', e.formas,
      'aviso', 'Histórico declarado na ECF do ano-calendário indicado; não é o regime vigente.',
      'simples', jsonb_build_object('competencia', s.dataset_version, 'status', s.status,
                                    'data_exclusao', v_saida)));
  end if;

  if v_teve then
    return jsonb_build_object('classe', 'excluido_simples', 'consulta', s.id, 'base', jsonb_build_object(
      'fonte', s.source_code, 'competencia', s.dataset_version, 'data_exclusao', v_saida,
      'ecf', case when e.ano is not null then jsonb_build_object('ano', e.ano, 'formas', e.formas) end));
  end if;

  return jsonb_build_object('classe', 'nao_identificado', 'consulta', s.id, 'base', jsonb_build_object(
    'fonte', s.source_code, 'competencia', s.dataset_version,
    'motivo', case
      when e.ano is not null then 'ECF do ano ' || e.ano || ' com forma que não define Real ou Presumido: ' || array_to_string(e.formas, ', ')
      when v_ecf_seen then 'Sem opção pelo Simples e sem ECF publicada para este CNPJ'
      else 'Sem opção pelo Simples; regime da ECF ainda não cruzado'
    end,
    'aviso', 'Ausência de opção pelo Simples não indica Lucro Presumido nem Lucro Real.'));
end $$;

create or replace function public.tax_ingest_classify(p_run uuid, p_after text default null, p_limit int default 5000)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_last text;
  v_n int := 0;
  v_changed int := 0;
  r record;
  c jsonb;
  v_new tax_classification;
begin
  perform tax_ingest_guard(p_run);
  for r in
    select e.cnpj::text cnpj, e.public_classification old
      from tax_entities e
     where (p_after is null or e.cnpj::text > p_after)
       and exists (select 1 from tax_relationships x where x.cnpj = e.cnpj)
     order by e.cnpj limit least(greatest(p_limit, 1), 10000)
  loop
    c := tax_classify_compute(r.cnpj);
    v_new := (c->>'classe')::tax_classification;
    update tax_entities set public_classification = v_new,
           public_classification_basis = coalesce(c->'base', '{}'::jsonb) || jsonb_build_object('execucao', p_run),
           public_classified_at = now(), updated_at = now()
     where cnpj = r.cnpj;
    if v_new is distinct from r.old and c ? 'consulta' and r.old <> 'consulta_pendente' then
      insert into tax_regime_events (lookup_key, granularity, event_type, effective_date, before, after, consultation_id)
      values (r.cnpj, 'estabelecimento', 'mudanca_classificacao_publica', current_date,
              jsonb_build_object('classe', r.old), jsonb_build_object('classe', v_new),
              (c->>'consulta')::uuid)
      on conflict do nothing;
    end if;
    if v_new is distinct from r.old then v_changed := v_changed + 1; end if;
    v_n := v_n + 1;
    v_last := r.cnpj;
  end loop;
  return jsonb_build_object('processed', v_n, 'changed', v_changed, 'last', v_last, 'done', v_n = 0);
end $$;

-- Resumo da competência, lido do banco (não das contas do executor): vale
-- também para execução retomada.
create or replace function public.tax_ingest_summary(p_run uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v tax_source_runs;
begin
  v := tax_ingest_guard(p_run);
  return jsonb_build_object(
    'competencia', v.competencia,
    'consultas', (select coalesce(jsonb_object_agg(source_code, x), '{}'::jsonb) from (
        select source_code, jsonb_build_object('ok', count(*) filter (where status = 'ok'),
                                               'nao_encontrado', count(*) filter (where status = 'nao_encontrado')) x
          from tax_consultations where dataset_version = v.competencia group by source_code) q),
    'classes', (select coalesce(jsonb_object_agg(c, n), '{}'::jsonb) from (
        select e.public_classification::text c, count(*) n from tax_entities e
         where exists (select 1 from tax_relationships r where r.cnpj = e.cnpj) group by 1) q),
    'cnpjs', (select count(distinct cnpj) from tax_relationships));
end $$;

create or replace function public.tax_ingest_finish_run(p_run uuid, p_status text, p_metrics jsonb, p_error text default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v tax_source_runs;
begin
  v := tax_ingest_guard(p_run);
  if p_status not in ('concluida', 'falhou', 'abortada_layout') then
    raise exception 'status final inválido' using errcode = '22023';
  end if;
  update tax_source_runs set
    status = p_status::tax_source_run_status,
    finished_at = now(),
    duration_seconds = extract(epoch from now() - started_at)::int,
    runner_minutes = nullif(p_metrics->>'runner_minutes', '')::numeric,
    bytes_downloaded = nullif(p_metrics->>'bytes_downloaded', '')::bigint,
    peak_disk_bytes = nullif(p_metrics->>'peak_disk_bytes', '')::bigint,
    rows_scanned = nullif(p_metrics->>'rows_scanned', '')::bigint,
    rows_matched = nullif(p_metrics->>'rows_matched', '')::bigint,
    metrics = coalesce(p_metrics, '{}'::jsonb),
    error = left(p_error, 4000)
  where id = p_run;
  return jsonb_build_object('run_id', p_run, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Visão do tenant: resultado da última execução para a carteira
-- ---------------------------------------------------------------------------
-- Leitura pelo front (authenticated): o que a carteira do tenant recebeu, sem
-- expor nada de outros tenants (RLS das tabelas faz o recorte).
create or replace function public.tax_portfolio_status(p_tenant uuid)
returns jsonb
language sql stable
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'cnpjs', count(distinct r.cnpj),
    'por_classe', coalesce((select jsonb_object_agg(classe, n) from (
        select e2.public_classification::text classe, count(distinct e2.cnpj) n
          from tax_relationships r2 join tax_entities e2 on e2.cnpj = r2.cnpj
         where r2.tenant_id = p_tenant group by 1) x), '{}'::jsonb),
    'ultima_consulta', max(e.last_consulted_at),
    'competencias', coalesce((select jsonb_agg(distinct c.dataset_version order by c.dataset_version desc)
        from tax_consultations c
        where c.dataset_version is not null and c.lookup_key in (
          select r3.cnpj from tax_relationships r3 where r3.tenant_id = p_tenant
          union select r3.cnpj_raiz from tax_relationships r3 where r3.tenant_id = p_tenant)), '[]'::jsonb))
  from tax_relationships r join tax_entities e on e.cnpj = r.cnpj
  where r.tenant_id = p_tenant;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privilégios
-- ---------------------------------------------------------------------------
revoke all on function public.tax_ingest_guard(uuid) from public, anon, authenticated;
revoke all on function public.tax_ingest_start_run(text, text[], text, text) from public, anon, authenticated;
revoke all on function public.tax_ingest_targets(uuid, text, int) from public, anon, authenticated;
revoke all on function public.tax_ingest_file(uuid, text, bigint, text, text[], bigint, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.tax_ingest_batch(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.tax_ingest_classify(uuid, text, int) from public, anon, authenticated;
revoke all on function public.tax_ingest_finish_run(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.tax_ingest_summary(uuid) from public, anon, authenticated;
revoke all on function public.tax_classify_compute(text) from public, anon, authenticated;
revoke all on function public.tax_normalize_ecf(text) from public, anon;
revoke all on function public.tax_portfolio_status(uuid) from public, anon;

grant execute on function public.tax_ingest_start_run(text, text[], text, text) to tax_ingestor;
grant execute on function public.tax_ingest_targets(uuid, text, int) to tax_ingestor;
grant execute on function public.tax_ingest_file(uuid, text, bigint, text, text[], bigint, bigint, bigint, text) to tax_ingestor;
grant execute on function public.tax_ingest_batch(uuid, text, jsonb) to tax_ingestor;
grant execute on function public.tax_ingest_classify(uuid, text, int) to tax_ingestor;
grant execute on function public.tax_ingest_finish_run(uuid, text, jsonb, text) to tax_ingestor;
grant execute on function public.tax_ingest_summary(uuid) to tax_ingestor;
grant execute on function public.tax_normalize_ecf(text) to authenticated, service_role;
grant execute on function public.tax_portfolio_status(uuid) to authenticated;
