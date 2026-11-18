-- 0253 · Inteligência Tributária: dados cadastrais da Receita no cadastro do CNPJ.
--
-- O executor já gravava, em cada consulta, a data de início de atividade e o
-- CNAE principal (Estabelecimentos) e a natureza jurídica e o porte (Empresas).
-- Agora esses campos vão para tax_entities, com a descrição oficial do CNAE e da
-- natureza (tabelas Cnaes e Naturezas da própria Receita, lidas pelo executor).
-- O cadastro (tax_entities) é cache do último arquivo lido: um lote repetido da
-- mesma competência também o atualiza. Consultas continuam imutáveis.
--
-- Reversão: recriar tax_ingest_batch como na 0252; alter table tax_entities drop
--   column data_abertura, cnae_principal, cnae_descricao, natureza_juridica,
--   natureza_descricao, porte.

alter table public.tax_entities
  add column if not exists data_abertura date,
  add column if not exists cnae_principal text check (cnae_principal is null or cnae_principal ~ '^[0-9]{7}$'),
  add column if not exists cnae_descricao text check (cnae_descricao is null or length(cnae_descricao) <= 300),
  add column if not exists natureza_juridica text check (natureza_juridica is null or natureza_juridica ~ '^[0-9]{4}$'),
  add column if not exists natureza_descricao text check (natureza_descricao is null or length(natureza_descricao) <= 200),
  add column if not exists porte text check (porte is null or porte ~ '^[0-9]{2}$');

-- Preenche com o que já foi consultado (última competência de cada chave).
with est as (
  select distinct on (lookup_key) lookup_key, response_raw r
    from public.tax_consultations
   where source_code = 'receita_estabelecimentos' and status = 'ok' and dataset_version is not null
   order by lookup_key, dataset_version desc, consulted_at desc
)
update public.tax_entities e set
  data_abertura = case when est.r->>'data_inicio_atividade' ~ '^(19|20)[0-9]{6}$'
                         and to_char(to_date(est.r->>'data_inicio_atividade', 'YYYYMMDD'), 'YYYYMMDD') = est.r->>'data_inicio_atividade'
                       then to_date(est.r->>'data_inicio_atividade', 'YYYYMMDD') end,
  cnae_principal = case when est.r->>'cnae_fiscal_principal' ~ '^[0-9]{7}$' then est.r->>'cnae_fiscal_principal' end
  from est where e.cnpj = est.lookup_key;

with emp as (
  select distinct on (lookup_key) lookup_key, response_raw r
    from public.tax_consultations
   where source_code = 'receita_empresas' and status = 'ok' and dataset_version is not null
   order by lookup_key, dataset_version desc, consulted_at desc
)
update public.tax_entities e set
  natureza_juridica = case when emp.r->>'natureza_juridica' ~ '^[0-9]{4}$' then emp.r->>'natureza_juridica' end,
  porte = case when emp.r->>'porte' ~ '^[0-9]{2}$' then emp.r->>'porte' end
  from emp where e.cnpj_raiz = emp.lookup_key;

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
    -- 0253: também natureza jurídica e porte. Vale para lote repetido da mesma
    -- competência (o cadastro é cache do último arquivo lido, não evidência).
    update tax_entities e set
      razao_social = left(t.n->>'razao_social', 300),
      natureza_juridica = case when t.n->>'natureza_juridica' ~ '^[0-9]{4}$' then t.n->>'natureza_juridica' end,
      natureza_descricao = coalesce(left(nullif(t.n->>'natureza_descricao', ''), 200), e.natureza_descricao),
      porte = case when t.n->>'porte' ~ '^[0-9]{2}$' then t.n->>'porte' end,
      updated_at = now()
      from tmp_ingest t
     where t.status = 'ok' and e.cnpj_raiz = t.key;

  elsif p_source = 'receita_estabelecimentos' then
    update tax_entities e set
      nome_fantasia = left(nullif(t.n->>'nome_fantasia', ''), 300),
      situacao_cadastral = left(nullif(t.n->>'situacao_cadastral', ''), 60),
      situacao_data = nullif(t.n->>'situacao_data', '')::date,
      uf = case when t.n->>'uf' ~ '^[A-Z]{2}$' then t.n->>'uf' end,
      municipio = left(nullif(t.n->>'municipio', ''), 120),
      data_abertura = case when t.n->>'data_abertura' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (t.n->>'data_abertura')::date end,
      cnae_principal = case when t.n->>'cnae_principal' ~ '^[0-9]{7}$' then t.n->>'cnae_principal' end,
      cnae_descricao = coalesce(left(nullif(t.n->>'cnae_descricao', ''), 300), e.cnae_descricao),
      updated_at = now()
      from tmp_ingest t
     where t.status = 'ok' and e.cnpj = t.key;

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

revoke all on function public.tax_ingest_batch(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tax_ingest_batch(uuid, text, jsonb) to tax_ingestor;
