-- 0252 · Inteligência Tributária: correções da classificação achadas no piloto
-- real (GDB, 1.904 CNPJs, 18/11/2026).
--
-- 1. ECF por raiz. A Receita publica o regime (ECF) no CNPJ da matriz. O motor
--    procurava pelo CNPJ exato, então a filial cuja matriz não estava na base
--    ficava sem regime. Agora o executor envia o regime por raiz, com o CNPJ
--    declarante em cada linha, e tax_regime_history guarda esse CNPJ (o da
--    matriz). Lotes antigos, de 14 dígitos, continuam aceitos.
-- 2. Saída do Simples no meio do ano. A ECF do próprio ano da saída passa a
--    decidir quando a saída foi antes de 31/12 (antes só valiam anos seguintes).
-- 3. CNPJ que não consta no cadastro da Receita não é classificado pela raiz do
--    Simples (falso positivo com CPF com "000" na frente). Quando o número é
--    "000" + um CPF válido, a base diz que é provável CPF, para o cliente corrigir.
-- Nada é regravado: consultas e histórico continuam imutáveis. A próxima
-- classificação (fim de cada carga) aplica as regras novas.
--
-- Reversão: recriar tax_ingest_batch e tax_classify_compute como na 0242;
--   drop function tax_cpf_is_valid(text).

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
  -- 0252: a ECF é declarada pela matriz; o executor passou a enviar o regime por
  -- raiz (8), com o CNPJ declarante em cada linha. Lote antigo (14) continua aceito.
  if p_source = 'receita_regime_tributario' and jsonb_typeof(p_rows) = 'array'
     and not exists (select 1 from jsonb_array_elements(p_rows) e where coalesce(e->>'key', '') !~ '^[0-9A-Z]{8}$') then
    v_gran := 'raiz';
  end if;
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
    select case when v_gran = 'raiz' then l->>'cnpj' else t.key end,
           (l->>'ano')::smallint, left(l->>'forma', 200),
           tax_normalize_ecf(l->>'forma'), nullif(left(l->>'cnpj_da_scp', 20), ''),
           nullif(l->>'quantidade', '')::int, v_run.competencia, t.consultation_id
      from tmp_ingest t
      cross join lateral jsonb_array_elements(t.n->'linhas') l
     where t.novo and t.status = 'ok' and (l->>'ano') ~ '^[0-9]{4}$' and length(coalesce(l->>'forma', '')) > 0
       -- Por raiz, a linha só vale com o CNPJ declarante válido e da mesma raiz.
       and (v_gran = 'estabelecimento'
            or (tax_cnpj_is_valid(l->>'cnpj') and substr(l->>'cnpj', 1, 8) = t.key))
    on conflict do nothing;
  end if;

  update tax_entities e set last_consulted_at = now()
    from tmp_ingest t
   where t.novo and ((v_gran = 'raiz' and e.cnpj_raiz = t.key) or (v_gran = 'estabelecimento' and e.cnpj = t.key));

  return jsonb_build_object('received', v_n, 'inserted', v_inserted, 'cached', v_n - v_inserted);
end $$;

-- Dígitos de CPF (11 números). Só para explicar o motivo; não guarda CPF nenhum.
create or replace function public.tax_cpf_is_valid(p text)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare s int := 0; d int; i int;
begin
  if p is null or p !~ '^[0-9]{11}$' or p ~ '^(.)\1{10}$' then return false; end if;
  for i in 1..9 loop s := s + substr(p, i, 1)::int * (11 - i); end loop;
  d := (s * 10) % 11; if d = 10 then d := 0; end if;
  if d <> substr(p, 10, 1)::int then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(p, i, 1)::int * (12 - i); end loop;
  d := (s * 10) % 11; if d = 10 then d := 0; end if;
  return d = substr(p, 11, 1)::int;
end $$;
revoke all on function public.tax_cpf_is_valid(text) from public, anon, authenticated;

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
  v_est tax_consultations;
begin
  -- 0252: CNPJ que não consta no cadastro da Receita (Estabelecimentos) não é
  -- classificado pela raiz: a raiz pode coincidir com outra empresa (ex.: CPF
  -- com "000" na frente, que passa no dígito do CNPJ por coincidência).
  select * into v_est from tax_consultations
   where source_code = 'receita_estabelecimentos' and lookup_key = p_cnpj and dataset_version is not null
   order by dataset_version desc, consulted_at desc limit 1;
  if v_est.id is not null and v_est.status = 'nao_encontrado' then
    if p_cnpj ~ '^000' and tax_cpf_is_valid(substr(p_cnpj, 4, 11)) then
      return jsonb_build_object('classe', 'nao_identificado', 'consulta', v_est.id, 'base', jsonb_build_object(
        'fonte', v_est.source_code, 'competencia', v_est.dataset_version, 'cnpj_inexistente', true,
        'provavel_cpf', true,
        'motivo', 'Provável CPF: o número não consta no cadastro de CNPJ da Receita e, sem os três zeros iniciais, é um CPF válido',
        'aviso', 'Pessoa física não tem regime de empresa. Corrija para o CNPJ da empresa ou retire da base.'));
    end if;
    return jsonb_build_object('classe', 'nao_identificado', 'consulta', v_est.id, 'base', jsonb_build_object(
      'fonte', v_est.source_code, 'competencia', v_est.dataset_version, 'cnpj_inexistente', true,
      'motivo', 'CNPJ não consta no cadastro da Receita',
      'aviso', 'Confira o número no cadastro de origem: pode estar digitado errado ou ter sido substituído.'));
  end if;

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
                                                union select p_cnpj union select v_raiz));

  -- ECF por raiz: a escrituração é da empresa (matriz), vale para as filiais.
  select h.ano, array_agg(distinct h.regime_normalizado) regs,
         array_agg(distinct h.forma_tributacao_original) formas,
         max(h.dataset_version) versao, (array_agg(h.consultation_id))[1] cid
    into e
    from tax_regime_history h
   -- 0252: a ECF do próprio ano da saída vale quando a saída foi antes de 31/12
   -- (a escrituração cobre o período fora do Simples). Saída em 31/12 → ano seguinte.
   where h.cnpj_raiz = v_raiz and (v_saida is null or h.ano >= extract(year from v_saida + 1))
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
      when v_ecf_seen then 'Sem opção pelo Simples e sem ECF publicada para esta empresa (matriz)'
      else 'Sem opção pelo Simples; regime da ECF ainda não cruzado'
    end,
    'aviso', 'Ausência de opção pelo Simples não indica Lucro Presumido nem Lucro Real.'));
end $$;

revoke all on function public.tax_ingest_batch(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tax_ingest_batch(uuid, text, jsonb) to tax_ingestor;
revoke all on function public.tax_classify_compute(text) from public, anon, authenticated;
