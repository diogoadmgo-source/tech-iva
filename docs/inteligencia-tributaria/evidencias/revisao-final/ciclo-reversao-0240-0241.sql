\set ON_ERROR_STOP on
begin;
\echo ANTES
select 'outros_objetos='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage','credit') and c.relname !~ '^tax_(sources|entities|consultations|regimes|regime_history|regime_events|imports|import_items|relationships|evidences|tenant_classifications|processing_jobs|job_items|audit_logs|source_runs|source_run_files)') ||' outras_funcoes='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname !~ '^tax_')||' outras_policies='||(select count(*) from pg_policies where policyname !~ '^tax_')||' modulo_tabelas='||(select count(*) from pg_tables where schemaname='public' and tablename ~ '^tax_' and tablename <> 'tax_cash_events' and tablename !~ '^tax_cash')||' modulo_funcoes='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^tax_')||' modulo_policies='||(select count(*) from pg_policies where policyname ~ '^tax_')||' buckets='||(select count(*) from storage.buckets where id like 'tax-%')||' hist='||(select count(*) from supabase_migrations.schema_migrations);
set local session_replication_role = replica; delete from storage.objects where bucket_id in ('tax-imports','tax-evidences'); set local session_replication_role = origin;
-- Reversão das migrations 0240 e 0241 (Inteligência Tributária).
--
-- NÃO é uma migration e NÃO fica em supabase/migrations/. Só deve ser executado
-- com autorização expressa, se a instalação no banco principal precisar ser desfeita.
--
-- Remove apenas objetos criados pelas duas migrations. Nenhum objeto anterior é
-- tocado: as 16 tabelas, 16 tipos, 2 domínios, as funções tax_* deste módulo, as 4
-- políticas de Storage e os 2 buckets (só se estiverem vazios).
--
-- ATENÇÃO: apaga os dados do módulo (importações, relacionamentos, evidências e
-- log de auditoria do módulo). Faça um dump dessas tabelas antes, se houver dados.
-- O registro em audit_log (tabela anterior ao módulo) é preservado.
--
-- Testado num Postgres descartável: instalar → reverter → catálogo igual ao de antes
-- → instalar de novo → suíte completa. Ver diagnostico-migrations.md.


-- Trava: só segue se os arquivos de Storage do módulo estiverem vazios. Se houver
-- arquivos, apague-os pela API do Storage (ou pelo painel) e rode de novo.
do $$
begin
  if exists (select 1 from storage.objects where bucket_id in ('tax-imports', 'tax-evidences')) then
    raise exception 'há arquivos nos buckets tax-imports/tax-evidences: remova-os pela API do Storage antes';
  end if;
end $$;

drop policy if exists tax_imports_upload on storage.objects;
drop policy if exists tax_imports_download on storage.objects;
drop policy if exists tax_evidences_upload on storage.objects;
drop policy if exists tax_evidences_download on storage.objects;

-- Tabelas (as políticas, gatilhos, índices e sequências delas vão junto).
drop table if exists
  public.tax_job_items, public.tax_processing_jobs, public.tax_tenant_classifications,
  public.tax_evidences, public.tax_audit_logs, public.tax_import_items, public.tax_imports,
  public.tax_relationships, public.tax_source_run_files, public.tax_source_runs,
  public.tax_regime_events, public.tax_regime_history, public.tax_regimes,
  public.tax_consultations, public.tax_entities, public.tax_sources
  cascade;

-- Funções do módulo (lista fechada; não usa prefixo para não alcançar nada anterior).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'tax_audit', 'tax_block_mutation', 'tax_can_read_audit', 'tax_can_read_evidence_file',
         'tax_can_read_import_file', 'tax_can_upload_evidence', 'tax_can_upload_import',
         'tax_can_write', 'tax_cnpj_is_valid', 'tax_cnpj_strip', 'tax_evidences_guard',
         'tax_import_add_items', 'tax_import_cancel', 'tax_import_create', 'tax_import_finalize',
         'tax_import_summary', 'tax_is_platform_manager', 'tax_key_visible',
         'tax_parse_relationship', 'tax_regimes_guard', 'tax_scope_tenants', 'tax_storage_tenant'])
  loop
    execute format('drop function %s cascade', r.sig);
  end loop;
end $$;

drop domain if exists public.tax_cnpj, public.tax_cnpj_raiz cascade;
drop type if exists
  public.tax_relationship_kind, public.tax_granularity, public.tax_tri_state,
  public.tax_classification, public.tax_consultation_status, public.tax_public_regime,
  public.tax_ecf_regime, public.tax_import_status, public.tax_import_item_status,
  public.tax_evidence_fact, public.tax_evidence_status, public.tax_evidence_origin,
  public.tax_job_kind, public.tax_job_status, public.tax_job_item_status,
  public.tax_source_run_status
  cascade;

-- Buckets vazios. No Supabase, a exclusão direta pode ser recusada pelo próprio
-- Storage; nesse caso eles ficam (vazios e privados) ou são removidos pelo painel.
do $$
begin
  delete from storage.buckets where id in ('tax-imports', 'tax-evidences');
exception when others then
  raise notice 'buckets não removidos por SQL (%): remova pelo painel do Storage se quiser', sqlerrm;
end $$;

-- Histórico: sem isto, o Supabase CLI acharia que as migrations continuam aplicadas.
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version in ('20261117200000', '20261117200100');
  end if;
end $$;

\echo DEPOIS_DA_REVERSAO
select 'outros_objetos='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage','credit') and c.relname !~ '^tax_(sources|entities|consultations|regimes|regime_history|regime_events|imports|import_items|relationships|evidences|tenant_classifications|processing_jobs|job_items|audit_logs|source_runs|source_run_files)') ||' outras_funcoes='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname !~ '^tax_')||' outras_policies='||(select count(*) from pg_policies where policyname !~ '^tax_')||' modulo_tabelas='||(select count(*) from pg_tables where schemaname='public' and tablename ~ '^tax_' and tablename <> 'tax_cash_events' and tablename !~ '^tax_cash')||' modulo_funcoes='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^tax_')||' modulo_policies='||(select count(*) from pg_policies where policyname ~ '^tax_')||' buckets='||(select count(*) from storage.buckets where id like 'tax-%')||' hist='||(select count(*) from supabase_migrations.schema_migrations);
-- 0240 — Inteligência Tributária: fundação (Fase 1)
-- ============================================================================
-- NÃO APLICADA. Só entra no Supabase com autorização expressa do usuário.
--
-- Três planos de dados, separados fisicamente:
--
--   PÚBLICO (global, SEM tenant_id): só o que veio de fonte pública.
--     tax_sources, tax_entities, tax_consultations, tax_regimes,
--     tax_regime_history, tax_regime_events
--   PRIVADO (por tenant, tenant_id NOT NULL, RLS por in_scope):
--     tax_imports, tax_import_items, tax_relationships, tax_evidences,
--     tax_tenant_classifications, tax_processing_jobs, tax_job_items,
--     tax_audit_logs
--   OPERACIONAL (global, só plataforma): tax_source_runs, tax_source_run_files
--
-- Regras que este arquivo garante no banco:
--   * Nenhuma tabela pública tem coluna de tenant, e nenhuma FK sai do plano
--     público para o privado.
--   * O front não grava em nenhuma tabela: escrita só por RPC security definer
--     (0241 e fases seguintes) ou service_role.
--   * Leitura do plano público só para CNPJs ligados a um tenant no escopo do
--     usuário: o cache não revela a carteira de outro tenant.
--   * Consultas, histórico ECF, eventos, evidências e logs são imutáveis.
--   * NÃO usa regime_from_registry / cnpj_registry / counterparties.regime
--     (regra antiga "não optante = Presumido", que não deve ser reutilizada).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CNPJ (numérico e alfanumérico — IN RFB 2.119/2022, alterada pela 2.229/2024)
-- ---------------------------------------------------------------------------
-- Formato: 12 posições [0-9A-Z] + 2 DVs numéricos. Valor do caractere =
-- ASCII − 48. Módulo 11, pesos 2..9 da direita para a esquerda; resto < 2 → 0.
-- Exemplo oficial da Receita: 12ABC34501DE35.
create or replace function public.tax_cnpj_is_valid(p text)
returns boolean
language plpgsql immutable parallel safe
set search_path = pg_catalog
as $$
declare
  w int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int;
  r int;
  d1 int;
  d2 int;
  i int;
begin
  if p is null or p !~ '^[0-9A-Z]{12}[0-9]{2}$' then return false; end if;
  if p ~ '^(.)\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + (ascii(substr(p, i, 1)) - 48) * w[i + 1]; end loop;
  r := s % 11;
  d1 := case when r < 2 then 0 else 11 - r end;
  s := d1 * w[13];
  for i in 1..12 loop s := s + (ascii(substr(p, i, 1)) - 48) * w[i]; end loop;
  r := s % 11;
  d2 := case when r < 2 then 0 else 11 - r end;
  return d1 = ascii(substr(p, 13, 1)) - 48 and d2 = ascii(substr(p, 14, 1)) - 48;
end $$;

-- Remove máscara e espaços e converte para maiúscula. NÃO completa zeros:
-- isso é decisão da importação (só para valor 100% numérico, e registrada).
create or replace function public.tax_cnpj_strip(p text)
returns text
language sql immutable parallel safe
set search_path = pg_catalog
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[[:space:]./\-]', '', 'g')), '');
$$;

create domain public.tax_cnpj as text
  check (value is null or public.tax_cnpj_is_valid(value));

create domain public.tax_cnpj_raiz as text
  check (value ~ '^[0-9A-Z]{8}$');

-- ---------------------------------------------------------------------------
-- 2. Tipos
-- ---------------------------------------------------------------------------
create type public.tax_relationship_kind as enum ('cliente', 'fornecedor');
create type public.tax_granularity as enum ('raiz', 'estabelecimento');
create type public.tax_tri_state as enum ('sim', 'nao', 'nao_identificado');

create type public.tax_classification as enum (
  'simples_nacional', 'mei_simei', 'simples_com_ibs_cbs_regular',
  'lucro_presumido', 'lucro_real', 'excluido_simples',
  'nao_identificado', 'consulta_pendente'
);

create type public.tax_consultation_status as enum ('ok', 'nao_encontrado', 'erro', 'fonte_indisponivel');
create type public.tax_public_regime as enum ('simples_nacional', 'simei');
create type public.tax_ecf_regime as enum (
  'lucro_real', 'lucro_presumido', 'lucro_arbitrado', 'imune', 'isenta', 'combinado', 'nao_mapeado'
);

create type public.tax_import_status as enum ('recebendo', 'finalizando', 'concluida', 'falhou', 'cancelada');
create type public.tax_import_item_status as enum (
  'recebido', 'valido', 'duplicado_no_arquivo', 'ja_existente',
  'cnpj_invalido', 'cnpj_ausente', 'relacionamento_invalido'
);

-- IBS e CBS são fatos separados: a evidência de um nunca depende da do outro.
create type public.tax_evidence_fact as enum (
  'ibs_regular', 'cbs_regular', 'lucro_real', 'lucro_presumido', 'simples_nacional', 'outro'
);
create type public.tax_evidence_status as enum ('ativa', 'revogada', 'substituida');
create type public.tax_evidence_origin as enum (
  'portal_simples_nacional', 'declaracao_contribuinte', 'documento_contabil', 'contrato', 'outro'
);

create type public.tax_job_kind as enum ('importacao', 'atualizar_empresas');
create type public.tax_job_status as enum ('ativo', 'pausado', 'concluido', 'falhou', 'cancelado');
create type public.tax_job_item_status as enum (
  'pendente', 'reservado', 'concluido', 'via_cache', 'nao_encontrado', 'erro'
);
create type public.tax_source_run_status as enum ('iniciada', 'concluida', 'falhou', 'abortada_layout');

-- ---------------------------------------------------------------------------
-- 3. Plano OPERACIONAL (global, só plataforma) — criado antes por causa da FK
-- ---------------------------------------------------------------------------
create table public.tax_source_runs (
  id               uuid primary key default gen_random_uuid(),
  competencia      text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  datasets         text[] not null check (cardinality(datasets) between 1 and 10),
  dry_run          boolean not null default false,
  status           public.tax_source_run_status not null default 'iniciada',
  triggered_by     text not null check (length(triggered_by) between 1 and 100),
  github_run_url   text check (github_run_url is null or github_run_url ~ '^https://github\.com/'),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  -- Medições pedidas para projetar custo (seção 6.3 da especificação).
  duration_seconds integer check (duration_seconds >= 0),
  runner_minutes   numeric(10,2) check (runner_minutes >= 0),
  bytes_downloaded bigint check (bytes_downloaded >= 0),
  peak_disk_bytes  bigint check (peak_disk_bytes >= 0),
  rows_scanned     bigint check (rows_scanned >= 0),
  rows_matched     bigint check (rows_matched >= 0),
  targets_count    integer check (targets_count >= 0),
  metrics          jsonb not null default '{}'::jsonb,
  error            text check (error is null or length(error) <= 4000)
);
create index tax_source_runs_started on public.tax_source_runs (started_at desc);

create table public.tax_source_run_files (
  run_id             uuid not null references public.tax_source_runs(id) on delete restrict,
  file_name          text not null check (file_name ~ '^[A-Za-z0-9 ._-]{1,200}$'),
  size_bytes         bigint check (size_bytes >= 0),
  sha256             text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  header             text[],
  rows_scanned       bigint not null default 0 check (rows_scanned >= 0),
  rows_matched       bigint not null default 0 check (rows_matched >= 0),
  last_row_committed bigint not null default 0 check (last_row_committed >= 0),
  status             text not null default 'pendente'
                     check (status in ('pendente', 'baixando', 'processando', 'concluido', 'falhou')),
  updated_at         timestamptz not null default now(),
  primary key (run_id, file_name)
);

-- ---------------------------------------------------------------------------
-- 4. Plano PÚBLICO (global, sem tenant_id)
-- ---------------------------------------------------------------------------
create table public.tax_sources (
  code          text primary key
                check (code ~ '^[a-z][a-z0-9_]{2,40}$' and code !~ 'evid'),
  name          text not null,
  kind          text not null check (kind in ('dados_abertos', 'api', 'sem_fonte')),
  url           text check (url is null or url ~ '^https://'),
  granularity   public.tax_granularity,
  coverage      text not null,
  limitations   text not null,
  status        text not null check (status in ('ativa', 'a_confirmar', 'indisponivel')),
  -- Fonte pública por definição. Evidência de tenant NUNCA é fonte.
  is_public     boolean not null default true check (is_public),
  verified_at   timestamptz,
  verified_note text,
  updated_at    timestamptz not null default now()
);

create table public.tax_entities (
  cnpj                public.tax_cnpj primary key,
  cnpj_raiz           text generated always as (substr(cnpj, 1, 8)) stored,
  cnpj_ordem          text generated always as (substr(cnpj, 9, 4)) stored,
  cnpj_dv             text generated always as (substr(cnpj, 13, 2)) stored,
  is_matriz           boolean generated always as (substr(cnpj, 9, 4) = '0001') stored,
  cnpj_alfanumerico   boolean generated always as (cnpj ~ '[A-Z]') stored,
  razao_social        text check (razao_social is null or length(razao_social) <= 300),
  nome_fantasia       text check (nome_fantasia is null or length(nome_fantasia) <= 300),
  situacao_cadastral  text check (situacao_cadastral is null or length(situacao_cadastral) <= 60),
  situacao_data       date,
  uf                  text check (uf is null or uf ~ '^[A-Z]{2}$'),
  municipio           text check (municipio is null or length(municipio) <= 120),
  municipio_ibge      text check (municipio_ibge is null or municipio_ibge ~ '^[0-9]{7}$'),
  -- Classificação PÚBLICA: calculada sem nenhuma evidência de tenant.
  public_classification       public.tax_classification not null default 'consulta_pendente',
  public_classification_basis jsonb not null default '{}'::jsonb,
  public_classified_at        timestamptz,
  last_consulted_at           timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index tax_entities_raiz on public.tax_entities (cnpj_raiz);
create index tax_entities_uf_municipio on public.tax_entities (uf, municipio);
create index tax_entities_public_class on public.tax_entities (public_classification);

create table public.tax_consultations (
  id                  uuid primary key default gen_random_uuid(),
  source_code         text not null references public.tax_sources(code) on delete restrict,
  -- Competência do dataset aberto (AAAA-MM) ou nulo para API.
  dataset_version     text check (dataset_version is null or dataset_version ~ '^[0-9]{4}-[0-9]{2}$'),
  lookup_key          text not null,
  granularity         public.tax_granularity not null,
  status              public.tax_consultation_status not null,
  http_status         integer check (http_status is null or http_status between 100 and 599),
  response_raw        jsonb check (response_raw is null or octet_length(response_raw::text) <= 262144),
  response_normalized jsonb,
  response_sha256     text check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  error               text check (error is null or length(error) <= 2000),
  source_run_id       uuid references public.tax_source_runs(id) on delete restrict,
  consulted_at        timestamptz not null default now(),
  constraint tax_consultations_key_format check (
    (granularity = 'estabelecimento' and public.tax_cnpj_is_valid(lookup_key))
    or (granularity = 'raiz' and lookup_key ~ '^[0-9A-Z]{8}$')
  )
);
create index tax_consultations_key on public.tax_consultations (lookup_key, consulted_at desc);
-- Idempotência do dado aberto: a mesma competência não grava duas vezes a mesma chave.
create unique index tax_consultations_open_data_once
  on public.tax_consultations (source_code, dataset_version, lookup_key)
  where dataset_version is not null;

create table public.tax_regimes (
  id              uuid primary key default gen_random_uuid(),
  regime          public.tax_public_regime not null,
  lookup_key      text not null,
  granularity     public.tax_granularity not null,
  start_date      date not null,
  end_date        date,
  consultation_id uuid not null references public.tax_consultations(id) on delete restrict,
  recorded_at     timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  constraint tax_regimes_key_format check (
    (granularity = 'estabelecimento' and public.tax_cnpj_is_valid(lookup_key))
    or (granularity = 'raiz' and lookup_key ~ '^[0-9A-Z]{8}$')
  ),
  unique (regime, lookup_key, start_date)
);
create index tax_regimes_key on public.tax_regimes (lookup_key);

-- Histórico anual declarado na ECF (Imunes e Isentas, Lucro Arbitrado,
-- Lucro Presumido, Lucro Real). É HISTÓRICO: nunca define a classe vigente.
create table public.tax_regime_history (
  id                        uuid primary key default gen_random_uuid(),
  cnpj                      public.tax_cnpj not null,
  cnpj_raiz                 text generated always as (substr(cnpj, 1, 8)) stored,
  ano                       smallint not null check (ano between 1990 and 2100),
  forma_tributacao_original text not null check (length(forma_tributacao_original) between 1 and 200),
  regime_normalizado        public.tax_ecf_regime not null,
  cnpj_da_scp               text check (cnpj_da_scp is null or length(cnpj_da_scp) <= 20),
  quantidade_escrituracoes  integer check (quantidade_escrituracoes is null or quantidade_escrituracoes >= 0),
  dataset_version           text not null check (dataset_version ~ '^[0-9]{4}-[0-9]{2}$'),
  consultation_id           uuid not null references public.tax_consultations(id) on delete restrict,
  recorded_at               timestamptz not null default now()
);
create unique index tax_regime_history_once on public.tax_regime_history
  (cnpj, ano, coalesce(cnpj_da_scp, ''), forma_tributacao_original, dataset_version);
create index tax_regime_history_raiz on public.tax_regime_history (cnpj_raiz, ano desc);

create table public.tax_regime_events (
  id                       uuid primary key default gen_random_uuid(),
  lookup_key               text not null,
  granularity              public.tax_granularity not null,
  event_type               text not null check (event_type in (
                             'opcao_simples', 'exclusao_simples', 'opcao_simei', 'exclusao_simei',
                             'mudanca_situacao_cadastral', 'novo_ano_ecf', 'mudanca_classificacao_publica')),
  event_date               date,
  effective_date           date,
  before                   jsonb,
  after                    jsonb,
  consultation_id          uuid not null references public.tax_consultations(id) on delete restrict,
  previous_consultation_id uuid references public.tax_consultations(id) on delete restrict,
  detected_at              timestamptz not null default now(),
  constraint tax_regime_events_key_format check (
    (granularity = 'estabelecimento' and public.tax_cnpj_is_valid(lookup_key))
    or (granularity = 'raiz' and lookup_key ~ '^[0-9A-Z]{8}$')
  )
);
create unique index tax_regime_events_once on public.tax_regime_events
  (lookup_key, event_type, coalesce(effective_date, 'infinity'::date), consultation_id);
create index tax_regime_events_key on public.tax_regime_events (lookup_key, detected_at desc);

-- ---------------------------------------------------------------------------
-- 5. Plano PRIVADO (por tenant)
-- ---------------------------------------------------------------------------
create table public.tax_imports (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.tenants(id) on delete restrict,
  file_name                  text not null check (length(file_name) between 1 and 200),
  storage_path               text not null unique,
  file_size_bytes            bigint not null check (file_size_bytes between 1 and 31457280),
  file_sha256                text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_kind                  text not null check (file_kind in ('xlsx', 'csv')),
  sheet_name                 text check (sheet_name is null or length(sheet_name) <= 100),
  expected_rows              integer not null check (expected_rows between 1 and 100000),
  received_rows              integer not null default 0 check (received_rows >= 0),
  -- Linha da planilha onde começam os dados (cabeçalho + 1), para o usuário
  -- achar o registro: linha na planilha = first_data_line + row_number − 1.
  first_data_line            integer not null default 2 check (first_data_line between 1 and 100),
  default_relationship       public.tax_relationship_kind,
  status                     public.tax_import_status not null default 'recebendo',
  valid_count                integer not null default 0,
  duplicate_count            integer not null default 0,
  existing_count             integer not null default 0,
  invalid_cnpj_count         integer not null default 0,
  missing_cnpj_count         integer not null default 0,
  invalid_relationship_count integer not null default 0,
  padded_count               integer not null default 0,
  new_relationships_count    integer not null default 0,
  unique_cnpjs               integer not null default 0,
  unique_roots               integer not null default 0,
  created_by                 uuid not null,
  created_at                 timestamptz not null default now(),
  finalized_by               uuid,
  finalized_at               timestamptz,
  canceled_by                uuid,
  canceled_at                timestamptz,
  error                      text check (error is null or length(error) <= 2000),
  check (received_rows <= expected_rows),
  -- O arquivo mora na pasta do próprio tenant.
  check (split_part(storage_path, '/', 1) = tenant_id::text and storage_path !~ '\.\.')
);
create index tax_imports_tenant on public.tax_imports (tenant_id, created_at desc, id);
create index tax_imports_sha on public.tax_imports (tenant_id, file_sha256);

create table public.tax_import_items (
  import_id          uuid not null references public.tax_imports(id) on delete restrict,
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  row_number         integer not null check (row_number between 1 and 100000),
  cnpj_raw           text check (cnpj_raw is null or length(cnpj_raw) <= 64),
  cnpj               public.tax_cnpj,
  normalization_note text check (normalization_note is null or length(normalization_note) <= 200),
  razao_social       text check (razao_social is null or length(razao_social) <= 300),
  nome_fantasia      text check (nome_fantasia is null or length(nome_fantasia) <= 300),
  relationship_raw   text check (relationship_raw is null or length(relationship_raw) <= 60),
  relationships      public.tax_relationship_kind[],
  status             public.tax_import_item_status not null,
  error              text check (error is null or length(error) <= 300),
  primary key (import_id, row_number),
  check (status in ('cnpj_invalido', 'cnpj_ausente') or cnpj is not null)
);
create index tax_import_items_status on public.tax_import_items (import_id, status, row_number);
-- Repetição no arquivo: linha anterior com o mesmo CNPJ (finalização por trechos).
create index tax_import_items_cnpj on public.tax_import_items (import_id, cnpj, row_number);
create index tax_import_items_tenant on public.tax_import_items (tenant_id);

create table public.tax_relationships (
  tenant_id              uuid not null references public.tenants(id) on delete restrict,
  cnpj                   public.tax_cnpj not null references public.tax_entities(cnpj) on delete restrict,
  cnpj_raiz              text generated always as (substr(cnpj, 1, 8)) stored,
  relationship           public.tax_relationship_kind not null,
  declared_razao_social  text check (declared_razao_social is null or length(declared_razao_social) <= 300),
  declared_nome_fantasia text check (declared_nome_fantasia is null or length(declared_nome_fantasia) <= 300),
  first_import_id        uuid references public.tax_imports(id) on delete restrict,
  last_import_id         uuid references public.tax_imports(id) on delete restrict,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (tenant_id, cnpj, relationship)
);
create index tax_relationships_cnpj on public.tax_relationships (cnpj);
create index tax_relationships_raiz on public.tax_relationships (cnpj_raiz);

-- Evidência documental PRIVADA do tenant. Nunca vira dado público.
create table public.tax_evidences (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  fact               public.tax_evidence_fact not null,
  asserted_value     public.tax_tri_state not null check (asserted_value in ('sim', 'nao')),
  lookup_key         text not null,
  granularity        public.tax_granularity not null,
  origin             public.tax_evidence_origin not null,
  origin_description text not null check (length(origin_description) between 3 and 1000),
  document_date      date not null,
  responsible_user   uuid not null,
  valid_from         date not null,
  valid_to           date,
  file_path          text,
  file_sha256        text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  file_mime          text check (file_mime is null or file_mime in
                       ('application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml')),
  file_size_bytes    bigint check (file_size_bytes is null or file_size_bytes between 1 and 20971520),
  status             public.tax_evidence_status not null default 'ativa',
  supersedes_id      uuid references public.tax_evidences(id) on delete restrict,
  revoked_by         uuid,
  revoked_at         timestamptz,
  revoke_reason      text check (revoke_reason is null or length(revoke_reason) <= 1000),
  created_at         timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (document_date <= current_date + 1),
  check ((file_path is null) = (file_sha256 is null)),
  check (file_path is null or (split_part(file_path, '/', 1) = tenant_id::text and file_path !~ '\.\.')),
  constraint tax_evidences_key_format check (
    (granularity = 'estabelecimento' and public.tax_cnpj_is_valid(lookup_key))
    or (granularity = 'raiz' and lookup_key ~ '^[0-9A-Z]{8}$')
  )
);
create index tax_evidences_lookup on public.tax_evidences (tenant_id, lookup_key, fact, status);

-- Classificação DO TENANT: fatos públicos + evidências só deste tenant.
-- IBS e CBS com estado e vigência próprios, independentes entre si.
create table public.tax_tenant_classifications (
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  cnpj           public.tax_cnpj not null references public.tax_entities(cnpj) on delete restrict,
  reference_date date not null,
  classification public.tax_classification not null,
  basis          jsonb not null default '{}'::jsonb,
  ibs_regular    public.tax_tri_state not null default 'nao_identificado',
  ibs_valid_from date,
  ibs_valid_to   date,
  ibs_basis      jsonb not null default '{}'::jsonb,
  cbs_regular    public.tax_tri_state not null default 'nao_identificado',
  cbs_valid_from date,
  cbs_valid_to   date,
  cbs_basis      jsonb not null default '{}'::jsonb,
  computed_at    timestamptz not null default now(),
  primary key (tenant_id, cnpj),
  check (ibs_valid_to is null or ibs_valid_from is null or ibs_valid_to >= ibs_valid_from),
  check (cbs_valid_to is null or cbs_valid_from is null or cbs_valid_to >= cbs_valid_from)
);
create index tax_tenant_classifications_class on public.tax_tenant_classifications (tenant_id, classification);

create table public.tax_processing_jobs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  kind         public.tax_job_kind not null,
  status       public.tax_job_status not null default 'ativo',
  import_id    uuid references public.tax_imports(id) on delete restrict,
  total        integer not null default 0 check (total >= 0),
  processed    integer not null default 0 check (processed >= 0),
  succeeded    integer not null default 0 check (succeeded >= 0),
  failed       integer not null default 0 check (failed >= 0),
  cached       integer not null default 0 check (cached >= 0),
  params       jsonb not null default '{}'::jsonb,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  heartbeat_at timestamptz,
  finished_at  timestamptz,
  error        text check (error is null or length(error) <= 2000),
  check (kind <> 'importacao' or import_id is not null)
);
create index tax_processing_jobs_tenant on public.tax_processing_jobs (tenant_id, created_at desc);
-- Um "atualizar empresas" ativo por tenant de cada vez.
create unique index tax_processing_jobs_one_refresh
  on public.tax_processing_jobs (tenant_id)
  where kind = 'atualizar_empresas' and status in ('ativo', 'pausado');

create table public.tax_job_items (
  job_id          uuid not null references public.tax_processing_jobs(id) on delete restrict,
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  cnpj            public.tax_cnpj not null,
  status          public.tax_job_item_status not null default 'pendente',
  attempts        smallint not null default 0 check (attempts between 0 and 20),
  lease_until     timestamptz,
  next_attempt_at timestamptz,
  last_error      text check (last_error is null or length(last_error) <= 1000),
  consultation_id uuid references public.tax_consultations(id) on delete restrict,
  updated_at      timestamptz not null default now(),
  primary key (job_id, cnpj)
);
create index tax_job_items_claim on public.tax_job_items (job_id, status, next_attempt_at);

create table public.tax_audit_logs (
  id          bigserial primary key,
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  actor_id    uuid,
  actor_role  text,
  action      text not null check (action ~ '^tax\.[a-z_.]{3,60}$'),
  target_type text not null check (length(target_type) <= 60),
  target_id   text check (target_id is null or length(target_id) <= 200),
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text check (user_agent is null or length(user_agent) <= 500),
  at          timestamptz not null default now()
);
create index tax_audit_logs_tenant on public.tax_audit_logs (tenant_id, at desc);

-- ---------------------------------------------------------------------------
-- 6. Imutabilidade
-- ---------------------------------------------------------------------------
create or replace function public.tax_block_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'registro imutável: % em %', tg_op, tg_table_name
    using errcode = '42501';
end $$;

create trigger tax_consultations_immutable before update or delete on public.tax_consultations
  for each row execute function public.tax_block_mutation();
create trigger tax_regime_history_immutable before update or delete on public.tax_regime_history
  for each row execute function public.tax_block_mutation();
create trigger tax_regime_events_immutable before update or delete on public.tax_regime_events
  for each row execute function public.tax_block_mutation();
create trigger tax_audit_logs_immutable before update or delete on public.tax_audit_logs
  for each row execute function public.tax_block_mutation();
-- truncate também é mutação.
create trigger tax_consultations_no_truncate before truncate on public.tax_consultations
  for each statement execute function public.tax_block_mutation();
create trigger tax_regime_history_no_truncate before truncate on public.tax_regime_history
  for each statement execute function public.tax_block_mutation();
create trigger tax_regime_events_no_truncate before truncate on public.tax_regime_events
  for each statement execute function public.tax_block_mutation();
create trigger tax_audit_logs_no_truncate before truncate on public.tax_audit_logs
  for each statement execute function public.tax_block_mutation();
create trigger tax_evidences_no_truncate before truncate on public.tax_evidences
  for each statement execute function public.tax_block_mutation();

-- Período de regime: só pode ganhar data de fim (nulo → data). Nada mais muda.
create or replace function public.tax_regimes_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'registro imutável: DELETE em tax_regimes' using errcode = '42501';
  end if;
  if old.end_date is not null
     or new.regime is distinct from old.regime
     or new.lookup_key is distinct from old.lookup_key
     or new.granularity is distinct from old.granularity
     or new.start_date is distinct from old.start_date
     or new.recorded_at is distinct from old.recorded_at then
    raise exception 'período de regime fechado não muda' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tax_regimes_guard before update or delete on public.tax_regimes
  for each row execute function public.tax_regimes_guard();

-- Evidência: o conteúdo não muda. Só a transição ativa → revogada/substituida.
create or replace function public.tax_evidences_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'registro imutável: DELETE em tax_evidences' using errcode = '42501';
  end if;
  if old.status <> 'ativa' or new.status = 'ativa'
     or (to_jsonb(new) - array['status', 'revoked_by', 'revoked_at', 'revoke_reason'])
        is distinct from (to_jsonb(old) - array['status', 'revoked_by', 'revoked_at', 'revoke_reason']) then
    raise exception 'evidência é imutável: corrija registrando nova versão' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tax_evidences_guard before update or delete on public.tax_evidences
  for each row execute function public.tax_evidences_guard();

-- ---------------------------------------------------------------------------
-- 7. Funções de visibilidade (usadas pelas políticas de RLS)
-- ---------------------------------------------------------------------------
-- Tenants que o usuário alcança: o MESMO critério de in_scope(), calculado uma
-- vez por consulta. As políticas usam "tenant_id = any ((select ...)::uuid[])": o
-- subselect vira InitPlan e não é reavaliado por linha. Com in_scope(tenant_id)
-- por linha, ler 70 mil relacionamentos levou 7,3 s no Postgres local (teste
-- 80_load); o tempo de leitura por política está nas evidências da Fase 1.
create or replace function public.tax_scope_tenants()
returns uuid[]
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(array_agg(t.id), '{}')
    from tenants t
   where t.path <@ any(auth_scopes());
$$;

-- Um CNPJ público só é visível a quem tem esse CNPJ (ou a raiz) na carteira de
-- um tenant do seu escopo. A plataforma (raiz da árvore) enxerga todos.
-- Mantida para checagens pontuais; as políticas usam a forma em lote abaixo.
create or replace function public.tax_key_visible(p_key text, p_granularity public.tax_granularity)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from tax_relationships r
     where r.tenant_id = any (tax_scope_tenants())
       and ((p_granularity = 'estabelecimento' and r.cnpj = p_key)
         or (p_granularity = 'raiz' and r.cnpj_raiz = p_key)));
$$;

-- Membro com papel de gestão no tenant raiz da plataforma.
create or replace function public.tax_is_platform_manager()
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from memberships m join tenants t on t.id = m.tenant_id
     where m.user_id = auth.uid() and t.kind = 'platform'
       and m.role in ('platform_admin', 'platform_ops'));
$$;

-- Primeiro segmento do caminho no Storage, se for UUID; senão nulo.
create or replace function public.tax_storage_tenant(p_name text)
returns uuid
language sql immutable
set search_path = pg_catalog
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' and p_name !~ '\.\.'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Auditoria do módulo (interna: authenticated NÃO executa, para não forjar)
-- ---------------------------------------------------------------------------
create or replace function public.tax_audit(
  p_tenant uuid, p_action text, p_target_type text, p_target_id text,
  p_before jsonb default null, p_after jsonb default null)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
begin
  insert into tax_audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id,
                              before, after, ip, user_agent)
  values (p_tenant, auth.uid(), role_in(p_tenant)::text, p_action, p_target_type, p_target_id,
          p_before, p_after,
          nullif(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), '')::inet,
          left(v_headers->>'user-agent', 500));
end $$;

-- ---------------------------------------------------------------------------
-- 9. RLS, privilégios
-- ---------------------------------------------------------------------------
-- O Supabase concede privilégios padrão a anon/authenticated em tabelas novas
-- do schema public: revogamos tudo e concedemos só SELECT a authenticated.
do $$
declare t text;
begin
  foreach t in array array[
    'tax_sources', 'tax_entities', 'tax_consultations', 'tax_regimes', 'tax_regime_history',
    'tax_regime_events', 'tax_imports', 'tax_import_items', 'tax_relationships', 'tax_evidences',
    'tax_tenant_classifications', 'tax_processing_jobs', 'tax_job_items', 'tax_audit_logs',
    'tax_source_runs', 'tax_source_run_files']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.tax_audit_logs_id_seq from public, anon, authenticated;
grant usage on sequence public.tax_audit_logs_id_seq to service_role;

-- Público: catálogo de fontes é aberto a qualquer usuário logado.
create policy tax_sources_read on public.tax_sources for select to authenticated using (true);
create policy tax_entities_read on public.tax_entities for select to authenticated
  using (exists (
    select 1 from public.tax_relationships r
     where r.tenant_id = any ((select public.tax_scope_tenants())::uuid[]) and r.cnpj = tax_entities.cnpj));
create policy tax_consultations_read on public.tax_consultations for select to authenticated
  using (exists (
    select 1 from public.tax_relationships r
     where r.tenant_id = any ((select public.tax_scope_tenants())::uuid[])
       and ((tax_consultations.granularity = 'estabelecimento' and r.cnpj = tax_consultations.lookup_key)
         or (tax_consultations.granularity = 'raiz' and r.cnpj_raiz = tax_consultations.lookup_key))));
create policy tax_regimes_read on public.tax_regimes for select to authenticated
  using (exists (
    select 1 from public.tax_relationships r
     where r.tenant_id = any ((select public.tax_scope_tenants())::uuid[])
       and ((tax_regimes.granularity = 'estabelecimento' and r.cnpj = tax_regimes.lookup_key)
         or (tax_regimes.granularity = 'raiz' and r.cnpj_raiz = tax_regimes.lookup_key))));
create policy tax_regime_history_read on public.tax_regime_history for select to authenticated
  using (exists (
    select 1 from public.tax_relationships r
     where r.tenant_id = any ((select public.tax_scope_tenants())::uuid[]) and r.cnpj_raiz = tax_regime_history.cnpj_raiz));
create policy tax_regime_events_read on public.tax_regime_events for select to authenticated
  using (exists (
    select 1 from public.tax_relationships r
     where r.tenant_id = any ((select public.tax_scope_tenants())::uuid[])
       and ((tax_regime_events.granularity = 'estabelecimento' and r.cnpj = tax_regime_events.lookup_key)
         or (tax_regime_events.granularity = 'raiz' and r.cnpj_raiz = tax_regime_events.lookup_key))));

-- Privado: leitura só no escopo do tenant.
create policy tax_imports_read on public.tax_imports for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));
create policy tax_import_items_read on public.tax_import_items for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));
create policy tax_relationships_read on public.tax_relationships for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));
create policy tax_evidences_read on public.tax_evidences for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));
create policy tax_tenant_classifications_read on public.tax_tenant_classifications for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));
create policy tax_processing_jobs_read on public.tax_processing_jobs for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));
create policy tax_job_items_read on public.tax_job_items for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));
-- Operacional: só gestores da plataforma.
create policy tax_source_runs_read on public.tax_source_runs for select to authenticated
  using (public.tax_is_platform_manager());
create policy tax_source_run_files_read on public.tax_source_run_files for select to authenticated
  using (public.tax_is_platform_manager());

-- Nenhuma política de INSERT/UPDATE/DELETE: o front não grava direto.

-- Log do módulo: papéis de auditoria (mesmo conjunto AUDITORS da navegação).
-- has_role é revogada de authenticated (0030) e a política roda com os
-- privilégios de quem consulta, então usamos um invólucro executável.
create or replace function public.tax_can_read_audit(p_tenant uuid)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select has_role(p_tenant, array['platform_admin', 'platform_ops', 'platform_risk',
                                  'channel_admin', 'owner', 'finance']::member_role[]);
$$;
create policy tax_audit_logs_read on public.tax_audit_logs for select to authenticated
  using (public.tax_can_read_audit(tenant_id));

-- Funções: nada para anon; visibilidade e validação para authenticated.
revoke all on function public.tax_cnpj_is_valid(text) from public, anon;
revoke all on function public.tax_cnpj_strip(text) from public, anon;
revoke all on function public.tax_scope_tenants() from public, anon;
revoke all on function public.tax_key_visible(text, public.tax_granularity) from public, anon;
revoke all on function public.tax_is_platform_manager() from public, anon;
revoke all on function public.tax_storage_tenant(text) from public, anon;
revoke all on function public.tax_can_read_audit(uuid) from public, anon;
revoke all on function public.tax_audit(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.tax_block_mutation() from public, anon, authenticated;
revoke all on function public.tax_regimes_guard() from public, anon, authenticated;
revoke all on function public.tax_evidences_guard() from public, anon, authenticated;
grant execute on function public.tax_cnpj_is_valid(text) to authenticated, service_role;
grant execute on function public.tax_cnpj_strip(text) to authenticated, service_role;
grant execute on function public.tax_scope_tenants() to authenticated;
grant execute on function public.tax_key_visible(text, public.tax_granularity) to authenticated;
grant execute on function public.tax_is_platform_manager() to authenticated;
grant execute on function public.tax_storage_tenant(text) to authenticated;
grant execute on function public.tax_can_read_audit(uuid) to authenticated;
grant usage on domain public.tax_cnpj to authenticated, service_role;
grant usage on domain public.tax_cnpj_raiz to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Storage: dois buckets privados, um por finalidade
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('tax-imports', 'tax-imports', false, 31457280,
   array['text/csv', 'application/vnd.ms-excel', 'text/plain',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('tax-evidences', 'tax-evidences', false, 20971520,
   array['application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml'])
on conflict (id) do nothing;

-- Arquivo importado: só sobe quem criou a importação, no caminho que o banco
-- gerou para ela, enquanto ela está "recebendo". Baixa só quem pode importar.
create or replace function public.tax_can_upload_import(p_name text)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from tax_imports i
     where i.storage_path = p_name
       and i.status = 'recebendo'
       and i.created_by = auth.uid()
       and has_role(i.tenant_id, array['platform_admin', 'platform_ops', 'channel_admin',
                                       'owner', 'finance']::member_role[]));
$$;

create or replace function public.tax_can_read_import_file(p_name text)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from tax_imports i
     where i.storage_path = p_name
       and has_role(i.tenant_id, array['platform_admin', 'platform_ops', 'channel_admin',
                                       'owner', 'finance']::member_role[]));
$$;

-- Evidência: sobe quem pode registrar evidência, só na pasta do tenant.
-- Baixa quem pode registrar + platform_risk (auditoria).
create or replace function public.tax_can_upload_evidence(p_name text)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select tax_storage_tenant(p_name) is not null
     and has_role(tax_storage_tenant(p_name),
                  array['platform_admin', 'platform_ops', 'channel_admin', 'owner', 'finance']::member_role[]);
$$;

create or replace function public.tax_can_read_evidence_file(p_name text)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from tax_evidences e
     where e.file_path = p_name
       and has_role(e.tenant_id, array['platform_admin', 'platform_ops', 'platform_risk',
                                       'channel_admin', 'owner', 'finance']::member_role[]));
$$;

revoke all on function public.tax_can_upload_import(text) from public, anon;
revoke all on function public.tax_can_read_import_file(text) from public, anon;
revoke all on function public.tax_can_upload_evidence(text) from public, anon;
revoke all on function public.tax_can_read_evidence_file(text) from public, anon;
grant execute on function public.tax_can_upload_import(text) to authenticated;
grant execute on function public.tax_can_read_import_file(text) to authenticated;
grant execute on function public.tax_can_upload_evidence(text) to authenticated;
grant execute on function public.tax_can_read_evidence_file(text) to authenticated;

create policy tax_imports_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'tax-imports' and public.tax_can_upload_import(name));
create policy tax_imports_download on storage.objects for select to authenticated
  using (bucket_id = 'tax-imports' and public.tax_can_read_import_file(name));
create policy tax_evidences_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'tax-evidences' and public.tax_can_upload_evidence(name));
create policy tax_evidences_download on storage.objects for select to authenticated
  using (bucket_id = 'tax-evidences' and public.tax_can_read_evidence_file(name));
-- Sem UPDATE/DELETE para authenticated: arquivo enviado não é trocado nem apagado.

-- ---------------------------------------------------------------------------
-- 11. Catálogo de fontes (estado conhecido em 17/11/2026)
-- ---------------------------------------------------------------------------
-- verified_at nulo = ainda não houve chamada real que confirme o formato.
insert into public.tax_sources (code, name, kind, url, granularity, coverage, limitations, status) values
  ('receita_simples', 'Receita Federal — dados abertos do CNPJ (Simples Nacional e SIMEI)',
   'dados_abertos', 'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/', 'raiz',
   'Opção pelo Simples e pelo SIMEI, com datas de opção e de exclusão, por raiz do CNPJ.',
   'Publicação mensal. Não informa a opção pelo regime regular de IBS/CBS. Layout a confirmar na primeira execução do executor.',
   'a_confirmar'),
  ('receita_estabelecimentos', 'Receita Federal — dados abertos do CNPJ (Estabelecimentos)',
   'dados_abertos', 'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/', 'estabelecimento',
   'Situação cadastral, UF, município e nome fantasia por estabelecimento.',
   'Publicação mensal. Layout a confirmar na primeira execução do executor.',
   'a_confirmar'),
  ('receita_empresas', 'Receita Federal — dados abertos do CNPJ (Empresas)',
   'dados_abertos', 'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/', 'raiz',
   'Razão social, natureza jurídica e porte por raiz.',
   'Publicação mensal. Layout a confirmar na primeira execução do executor.',
   'a_confirmar'),
  ('receita_regime_tributario', 'Receita Federal — regime tributário declarado na ECF',
   'dados_abertos', null, 'estabelecimento',
   'Imunes e Isentas, Lucro Arbitrado, Lucro Presumido e Lucro Real por ano-calendário, chaveado pelo CNPJ completo (segundo a documentação da Minha Receita).',
   'Histórico anual, publicado no ano seguinte à entrega da ECF. Não representa o regime vigente. Optantes do Simples não entregam ECF. Endereço, layout, anos e valores a confirmar.',
   'a_confirmar'),
  ('brasilapi_cnpj', 'BrasilAPI — CNPJ',
   'api', 'https://brasilapi.com.br/api/cnpj/v1/', 'estabelecimento',
   'Consulta pontual por CNPJ: dados cadastrais do estabelecimento e Simples/SIMEI da raiz.',
   'Campos e limite de requisições a confirmar com chamada real. Usada só como complemento do cruzamento local.',
   'a_confirmar'),
  ('ibs_cbs_regular', 'Opção do Simples Nacional pelo regime regular de IBS/CBS',
   'sem_fonte', null, 'raiz',
   'Nenhuma.',
   'Não há fonte pública gratuita confirmada. Estado público sempre "não identificado". A informação só entra por evidência documental privada do tenant.',
   'indisponivel');
-- 0241 — Inteligência Tributária: importação de base (Fase 1)
-- ============================================================================
-- NÃO APLICADA. Depende da 0240.
--
-- Fluxo (até 100 mil linhas; meta de aceite: 70 mil):
--   1. tax_import_create     → registra a importação e devolve o caminho no
--                              Storage onde o arquivo original deve ser enviado.
--   2. upload do arquivo     → política do bucket só aceita esse caminho, de
--                              quem criou a importação, enquanto "recebendo".
--   3. tax_import_add_items  → lotes de até 1.000 linhas. O banco REVALIDA
--                              tudo (não confia no navegador). Idempotente por
--                              (import_id, row_number).
--   4. tax_import_finalize   → deduplica, separa o que já existia, cria
--                              entidades e relacionamentos, em trechos de até
--                              10 mil linhas por chamada (cabe no
--                              statement_timeout); o cliente repete até
--                              "done". Idempotente e retomável.
--   Retomada: o lote é uma transação; received_rows diz de onde continuar.
--
-- Segurança: todas security definer com search_path fixo, papel conferido em
-- cada chamada, entrada validada (tipo, tamanho, faixa), EXECUTE só para
-- authenticated. Toda operação grava tax_audit_logs e log_audit.
-- ============================================================================

-- Papéis que podem importar e atualizar (seção 3.5 da especificação).
create or replace function public.tax_can_write(p_tenant uuid)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select has_role(p_tenant, array['platform_admin', 'platform_ops', 'channel_admin',
                                  'owner', 'finance']::member_role[]);
$$;
revoke all on function public.tax_can_write(uuid) from public, anon, authenticated;

-- Tipo de relacionamento por texto livre. Nulo = célula vazia (usa o padrão
-- escolhido na importação); '{}' = texto não reconhecido.
-- Espelhado em src/lib/tax-intel/relationship.ts (mesmos casos de teste).
create or replace function public.tax_parse_relationship(p text)
returns public.tax_relationship_kind[]
language plpgsql immutable parallel safe
set search_path = public, pg_temp
as $$
declare
  v text := lower(btrim(translate(coalesce(p, ''),
                  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                  'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')));
begin
  v := regexp_replace(v, '[[:space:]]+', ' ', 'g');
  if v = '' then return null; end if;
  if v in ('cliente', 'clientes', 'c') then
    return array['cliente']::tax_relationship_kind[];
  end if;
  if v in ('fornecedor', 'fornecedores', 'f') then
    return array['fornecedor']::tax_relationship_kind[];
  end if;
  if v in ('ambos', 'cliente e fornecedor', 'fornecedor e cliente', 'cliente/fornecedor',
           'fornecedor/cliente', 'cliente;fornecedor', 'cliente,fornecedor', 'c/f', 'f/c', 'cf') then
    return array['cliente', 'fornecedor']::tax_relationship_kind[];
  end if;
  return '{}'::tax_relationship_kind[];
end $$;
revoke all on function public.tax_parse_relationship(text) from public, anon;
grant execute on function public.tax_parse_relationship(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Criar importação
-- ---------------------------------------------------------------------------
create or replace function public.tax_import_create(
  p_tenant uuid,
  p_file_name text,
  p_file_size bigint,
  p_file_sha256 text,
  p_file_kind text,
  p_sheet_name text,
  p_expected_rows integer,
  p_default_relationship public.tax_relationship_kind default null,
  p_first_data_line integer default 2)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_kind tenant_kind;
  v_safe_name text;
  v_path text;
  v_job uuid;
  v_previous jsonb;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_tenant is null or not tax_can_write(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select kind into v_kind from tenants where id = p_tenant and status = 'active';
  if v_kind is null or v_kind not in ('company', 'unit') then
    raise exception 'Importação disponível só para empresa ou unidade' using errcode = '22023';
  end if;

  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 200 then
    raise exception 'Nome de arquivo inválido' using errcode = '22023';
  end if;
  if p_file_kind is null or p_file_kind not in ('xlsx', 'csv') then
    raise exception 'Tipo de arquivo inválido: use XLSX ou CSV' using errcode = '22023';
  end if;
  if p_file_size is null or p_file_size not between 1 and 31457280 then
    raise exception 'Arquivo acima de 30 MB' using errcode = '22023';
  end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash do arquivo inválido' using errcode = '22023';
  end if;
  if p_expected_rows is null or p_expected_rows not between 1 and 100000 then
    raise exception 'O arquivo precisa ter entre 1 e 100.000 linhas' using errcode = '22023';
  end if;
  if p_first_data_line is null or p_first_data_line not between 1 and 100 then
    raise exception 'Linha inicial inválida' using errcode = '22023';
  end if;
  if p_sheet_name is not null and length(p_sheet_name) > 100 then
    raise exception 'Nome de aba inválido' using errcode = '22023';
  end if;

  -- O caminho é gerado aqui: o cliente não escolhe onde o arquivo mora.
  v_safe_name := left(regexp_replace(btrim(p_file_name), '[^A-Za-z0-9._-]+', '_', 'g'), 120);
  v_safe_name := regexp_replace(v_safe_name, '\.{2,}', '.', 'g');
  v_path := p_tenant::text || '/' || v_id::text || '/' || v_safe_name;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'status', i.status)
                            order by i.created_at desc), '[]'::jsonb)
    into v_previous
    from tax_imports i
   where i.tenant_id = p_tenant and i.file_sha256 = p_file_sha256 and i.status <> 'cancelada';

  insert into tax_imports (id, tenant_id, file_name, storage_path, file_size_bytes, file_sha256,
                           file_kind, sheet_name, expected_rows, default_relationship,
                           first_data_line, created_by)
  values (v_id, p_tenant, btrim(p_file_name), v_path, p_file_size, p_file_sha256,
          p_file_kind, p_sheet_name, p_expected_rows, p_default_relationship,
          p_first_data_line, auth.uid());

  insert into tax_processing_jobs (tenant_id, kind, import_id, total, created_by, heartbeat_at)
  values (p_tenant, 'importacao', v_id, p_expected_rows, auth.uid(), now())
  returning id into v_job;

  perform tax_audit(p_tenant, 'tax.import.create', 'tax_imports', v_id::text, null,
                    jsonb_build_object('file_name', btrim(p_file_name), 'file_sha256', p_file_sha256,
                                       'expected_rows', p_expected_rows, 'file_kind', p_file_kind,
                                       'default_relationship', p_default_relationship));
  perform log_audit(p_tenant, 'tax.import.create', 'tax_imports', v_id::text, null,
                    jsonb_build_object('expected_rows', p_expected_rows));

  return jsonb_build_object('import_id', v_id, 'job_id', v_job, 'storage_path', v_path,
                            'same_file_imports', v_previous);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Receber um lote (até 1.000 linhas)
-- ---------------------------------------------------------------------------
-- p_rows: [{"r": 1, "cnpj": "...", "razao": "...", "fantasia": "...", "rel": "..."}]
-- Qualquer elemento fora do formato rejeita o lote inteiro (nada é gravado).
create or replace function public.tax_import_add_items(p_import uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_imp tax_imports;
  v_n int;
  v_bad int;
  v_inserted int;
  v_received int;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Trava a importação: lotes concorrentes da mesma importação são serializados.
  select * into v_imp from tax_imports where id = p_import for update;
  if v_imp.id is null or not tax_can_write(v_imp.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_imp.status <> 'recebendo' then
    raise exception 'Importação não está recebendo linhas (status: %)', v_imp.status using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Lote inválido: esperado uma lista' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n not between 1 and 1000 then
    raise exception 'Lote inválido: de 1 a 1.000 linhas por chamada (recebido %)', v_n using errcode = '22023';
  end if;
  if octet_length(p_rows::text) > 2000000 then
    raise exception 'Lote inválido: acima de 2 MB' using errcode = '22023';
  end if;

  -- CASE garante a ordem de avaliação (o cast de "r" só roda depois de
  -- conferido o formato) e trata chave ausente como nula, não como erro.
  select count(*) into v_bad
    from jsonb_array_elements(p_rows) e
   where case
           when jsonb_typeof(e) is distinct from 'object' then true
           when jsonb_typeof(e->'r') is distinct from 'number' then true
           when (e->>'r') !~ '^[0-9]{1,6}$' then true
           when (e->>'r')::int not between 1 and v_imp.expected_rows then true
           when jsonb_typeof(e->'cnpj') not in ('string', 'null') then true
           when jsonb_typeof(e->'razao') not in ('string', 'null') then true
           when jsonb_typeof(e->'fantasia') not in ('string', 'null') then true
           when jsonb_typeof(e->'rel') not in ('string', 'null') then true
           when length(coalesce(e->>'cnpj', '')) > 64 then true
           when length(coalesce(e->>'razao', '')) > 300 then true
           when length(coalesce(e->>'fantasia', '')) > 300 then true
           when length(coalesce(e->>'rel', '')) > 60 then true
           when (select count(*) from jsonb_object_keys(e) k
                  where k not in ('r', 'cnpj', 'razao', 'fantasia', 'rel')) > 0 then true
           else false
         end;
  if v_bad > 0 then
    raise exception 'Lote inválido: % linha(s) fora do formato', v_bad using errcode = '22023';
  end if;

  select count(*) - count(distinct (e->>'r')::int) into v_bad from jsonb_array_elements(p_rows) e;
  if v_bad > 0 then
    raise exception 'Lote inválido: número de linha repetido no lote' using errcode = '22023';
  end if;

  with src as (
    select (e->>'r')::int as row_number,
           nullif(btrim(e->>'cnpj'), '') as cnpj_raw,
           nullif(btrim(e->>'razao'), '') as razao,
           nullif(btrim(e->>'fantasia'), '') as fantasia,
           nullif(btrim(e->>'rel'), '') as rel_raw
      from jsonb_array_elements(p_rows) e
  ), norm as (
    select s.*,
           tax_cnpj_strip(s.cnpj_raw) as stripped,
           coalesce(tax_parse_relationship(s.rel_raw),
                    case when v_imp.default_relationship is not null
                         then array[v_imp.default_relationship] end) as rels
      from src s
  ), padded as (
    -- Zeros à esquerda perdidos pelo Excel: só valor 100% numérico de 12 ou 13 dígitos.
    select n.*,
           case when n.stripped ~ '^[0-9]{12,13}$' then lpad(n.stripped, 14, '0') else n.stripped end as candidate,
           n.stripped ~ '^[0-9]{12,13}$' as was_padded
      from norm n
  )
  insert into tax_import_items (import_id, tenant_id, row_number, cnpj_raw, cnpj, normalization_note,
                                razao_social, nome_fantasia, relationship_raw, relationships, status, error)
  select p_import, v_imp.tenant_id, p.row_number, p.cnpj_raw,
         case when tax_cnpj_is_valid(p.candidate) then p.candidate end,
         case when p.was_padded and tax_cnpj_is_valid(p.candidate) then 'zeros à esquerda completados' end,
         p.razao, p.fantasia, p.rel_raw,
         case when cardinality(p.rels) > 0 then p.rels end,
         case
           when p.cnpj_raw is null then 'cnpj_ausente'
           when not tax_cnpj_is_valid(p.candidate) then 'cnpj_invalido'
           when p.rels is null or cardinality(p.rels) = 0 then 'relacionamento_invalido'
           else 'recebido'
         end::tax_import_item_status,
         case
           when p.cnpj_raw is null then 'CNPJ vazio'
           when p.candidate is null or p.candidate !~ '^[0-9A-Z]{12}[0-9]{2}$' then 'Formato inválido'
           when not tax_cnpj_is_valid(p.candidate) then 'Dígito verificador não confere'
           when p.rels is null then 'Tipo de relacionamento vazio e sem padrão definido'
           when cardinality(p.rels) = 0 then 'Tipo de relacionamento não reconhecido'
         end
    from padded p
  on conflict (import_id, row_number) do nothing;
  get diagnostics v_inserted = row_count;

  select count(*) into v_received from tax_import_items where import_id = p_import;
  update tax_imports set received_rows = v_received where id = p_import;
  update tax_processing_jobs set processed = v_received, heartbeat_at = now()
   where import_id = p_import and kind = 'importacao';

  return jsonb_build_object('received_rows', v_received, 'inserted', v_inserted,
                            'ignored_already_received', v_n - v_inserted,
                            'expected_rows', v_imp.expected_rows);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Finalizar (idempotente)
-- ---------------------------------------------------------------------------
create or replace function public.tax_import_finalize(p_import uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Cada chamada processa no máximo v_chunk linhas, para caber com folga no
  -- statement_timeout do papel authenticated no Supabase (8 s por padrão). O
  -- cliente chama de novo enquanto "done" for false. 70 mil linhas = 7 chamadas.
  v_chunk constant int := 10000;
  v_imp tax_imports;
  v_summary jsonb;
  v_new_rel int;
  v_upto int;
  v_remaining int;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_imp from tax_imports where id = p_import for update;
  if v_imp.id is null or not tax_can_write(v_imp.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_imp.status = 'concluida' then
    return tax_import_summary(v_imp) || jsonb_build_object('done', true);
  end if;
  if v_imp.status not in ('recebendo', 'finalizando') then
    raise exception 'Importação não pode ser finalizada (status: %)', v_imp.status using errcode = '22023';
  end if;
  if v_imp.received_rows < v_imp.expected_rows then
    raise exception 'Importação incompleta: recebidas % de % linhas', v_imp.received_rows, v_imp.expected_rows
      using errcode = '22023';
  end if;

  if v_imp.status = 'recebendo' then
    -- A partir daqui não entra arquivo nem linha nova, e não se cancela.
    update tax_imports set status = 'finalizando' where id = p_import;
  end if;

  -- Serializa finalizações do mesmo tenant: "novo × já existente" fica exato.
  perform pg_advisory_xact_lock(hashtextextended('tax_import_finalize:' || v_imp.tenant_id::text, 0));

  -- Próximo trecho: as v_chunk primeiras linhas ainda "recebido", em ordem.
  select max(row_number) into v_upto
    from (select row_number from tax_import_items
           where import_id = p_import and status = 'recebido'
           order by row_number limit v_chunk) x;

  if v_upto is not null then
    -- Pares (linha, CNPJ, relacionamento) do trecho. Um par é repetição se
    -- uma linha ANTERIOR do mesmo arquivo (deste ou de trecho já processado)
    -- tem o mesmo CNPJ e relacionamento; vale a primeira ocorrência. A regra
    -- não depende do tamanho do trecho.
    if to_regclass('pg_temp.tmp_pairs') is not null then drop table tmp_pairs; end if;
    create temporary table tmp_pairs on commit drop as
      select i.row_number, i.cnpj::text as cnpj, rel, i.razao_social, i.nome_fantasia,
             exists (select 1 from tax_import_items e
                      where e.import_id = p_import and e.cnpj = i.cnpj and e.row_number < i.row_number
                        and e.status in ('recebido', 'valido', 'ja_existente', 'duplicado_no_arquivo')
                        and rel = any (e.relationships)) as repeated,
             exists (select 1 from tax_relationships r
                      where r.tenant_id = v_imp.tenant_id and r.cnpj = i.cnpj and r.relationship = rel) as existed
        from tax_import_items i
        cross join lateral unnest(i.relationships) as rel
       where i.import_id = p_import and i.status = 'recebido' and i.row_number <= v_upto;
    -- Tabela temporária não recebe autovacuum: sem estatística o planejador
    -- estima 1 linha e pode escolher laço aninhado (140 s em 70 mil linhas).
    analyze tmp_pairs;

    update tax_import_items i set status = x.new_status
      from (
        select p.row_number,
               case
                 when bool_and(p.repeated) then 'duplicado_no_arquivo'
                 when bool_and(p.repeated or p.existed) then 'ja_existente'
                 else 'valido'
               end::tax_import_item_status as new_status
          from tmp_pairs p
         group by p.row_number
      ) x
     where i.import_id = p_import and i.row_number = x.row_number;

    insert into tax_entities (cnpj)
    select distinct p.cnpj from tmp_pairs p where not p.repeated
    on conflict (cnpj) do nothing;

    -- Primeira ocorrência de cada par dentro do trecho (as anteriores já
    -- foram excluídas por "repeated").
    insert into tax_relationships (tenant_id, cnpj, relationship, declared_razao_social,
                                   declared_nome_fantasia, first_import_id, last_import_id, created_by)
    select distinct on (p.cnpj, p.rel)
           v_imp.tenant_id, p.cnpj, p.rel, p.razao_social, p.nome_fantasia, p_import, p_import, auth.uid()
      from tmp_pairs p
     where not p.repeated
     order by p.cnpj, p.rel, p.row_number
    on conflict (tenant_id, cnpj, relationship) do update
      set last_import_id = excluded.last_import_id,
          declared_razao_social = coalesce(excluded.declared_razao_social, tax_relationships.declared_razao_social),
          declared_nome_fantasia = coalesce(excluded.declared_nome_fantasia, tax_relationships.declared_nome_fantasia),
          updated_at = now();

    select count(distinct (p.cnpj, p.rel)) into v_new_rel from tmp_pairs p where not p.repeated and not p.existed;
    update tax_imports set new_relationships_count = new_relationships_count + v_new_rel where id = p_import;
  end if;

  select count(*) into v_remaining from tax_import_items where import_id = p_import and status = 'recebido';
  if v_remaining > 0 then
    update tax_processing_jobs set processed = v_imp.received_rows - v_remaining, heartbeat_at = now()
     where import_id = p_import and kind = 'importacao';
    return jsonb_build_object('import_id', p_import, 'status', 'finalizando', 'done', false,
                              'remaining_rows', v_remaining, 'expected_rows', v_imp.expected_rows);
  end if;

  update tax_imports t set
    status = 'concluida',
    finalized_by = auth.uid(),
    finalized_at = now(),
    valid_count = c.valid,
    duplicate_count = c.dup,
    existing_count = c.existing,
    invalid_cnpj_count = c.inv_cnpj,
    missing_cnpj_count = c.missing,
    invalid_relationship_count = c.inv_rel,
    padded_count = c.padded,
    unique_cnpjs = c.uniq,
    unique_roots = c.roots
  from (
    select count(*) filter (where status = 'valido') as valid,
           count(*) filter (where status = 'duplicado_no_arquivo') as dup,
           count(*) filter (where status = 'ja_existente') as existing,
           count(*) filter (where status = 'cnpj_invalido') as inv_cnpj,
           count(*) filter (where status = 'cnpj_ausente') as missing,
           count(*) filter (where status = 'relacionamento_invalido') as inv_rel,
           count(*) filter (where normalization_note is not null) as padded,
           count(distinct cnpj) filter (where status in ('valido', 'duplicado_no_arquivo', 'ja_existente')) as uniq,
           count(distinct substr(cnpj, 1, 8)) filter (where status in ('valido', 'duplicado_no_arquivo', 'ja_existente')) as roots
      from tax_import_items where import_id = p_import
  ) c
  where t.id = p_import
  returning * into v_imp;

  update tax_processing_jobs set status = 'concluido', processed = v_imp.received_rows,
         succeeded = v_imp.valid_count + v_imp.existing_count + v_imp.duplicate_count,
         failed = v_imp.invalid_cnpj_count + v_imp.missing_cnpj_count + v_imp.invalid_relationship_count,
         finished_at = now(), heartbeat_at = now()
   where import_id = p_import and kind = 'importacao';

  v_summary := tax_import_summary(v_imp);
  perform tax_audit(v_imp.tenant_id, 'tax.import.finalize', 'tax_imports', p_import::text, null, v_summary);
  perform log_audit(v_imp.tenant_id, 'tax.import.finalize', 'tax_imports', p_import::text, null, v_summary);
  return v_summary || jsonb_build_object('done', true);
end $$;

create or replace function public.tax_import_summary(v tax_imports)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'import_id', v.id, 'status', v.status,
    'expected_rows', v.expected_rows, 'received_rows', v.received_rows,
    'valid', v.valid_count, 'duplicate_in_file', v.duplicate_count, 'already_existing', v.existing_count,
    'invalid_cnpj', v.invalid_cnpj_count, 'missing_cnpj', v.missing_cnpj_count,
    'invalid_relationship', v.invalid_relationship_count, 'padded', v.padded_count,
    'new_relationships', v.new_relationships_count,
    'unique_cnpjs', v.unique_cnpjs, 'unique_roots', v.unique_roots,
    'finalized_at', v.finalized_at);
$$;

-- ---------------------------------------------------------------------------
-- 4. Cancelar (as linhas recebidas ficam para auditoria)
-- ---------------------------------------------------------------------------
create or replace function public.tax_import_cancel(p_import uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_imp tax_imports;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_imp from tax_imports where id = p_import for update;
  if v_imp.id is null or not tax_can_write(v_imp.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_imp.status <> 'recebendo' then
    raise exception 'Só uma importação em andamento pode ser cancelada' using errcode = '22023';
  end if;
  update tax_imports set status = 'cancelada', canceled_by = auth.uid(), canceled_at = now()
   where id = p_import;
  update tax_processing_jobs set status = 'cancelado', finished_at = now()
   where import_id = p_import and kind = 'importacao';
  perform tax_audit(v_imp.tenant_id, 'tax.import.cancel', 'tax_imports', p_import::text,
                    jsonb_build_object('received_rows', v_imp.received_rows), null);
  perform log_audit(v_imp.tenant_id, 'tax.import.cancel', 'tax_imports', p_import::text, null, null);
  return jsonb_build_object('import_id', p_import, 'status', 'cancelada');
end $$;

revoke all on function public.tax_import_create(uuid, text, bigint, text, text, text, integer, public.tax_relationship_kind, integer)
  from public, anon;
revoke all on function public.tax_import_add_items(uuid, jsonb) from public, anon;
revoke all on function public.tax_import_finalize(uuid) from public, anon;
revoke all on function public.tax_import_cancel(uuid) from public, anon;
revoke all on function public.tax_import_summary(public.tax_imports) from public, anon, authenticated;
grant execute on function public.tax_import_create(uuid, text, bigint, text, text, text, integer, public.tax_relationship_kind, integer)
  to authenticated;
grant execute on function public.tax_import_add_items(uuid, jsonb) to authenticated;
grant execute on function public.tax_import_finalize(uuid) to authenticated;
grant execute on function public.tax_import_cancel(uuid) to authenticated;
insert into supabase_migrations.schema_migrations(version,name) values ('20261117200000','x'),('20261117200100','y');
\echo DEPOIS_DE_REINSTALAR
select 'outros_objetos='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage','credit') and c.relname !~ '^tax_(sources|entities|consultations|regimes|regime_history|regime_events|imports|import_items|relationships|evidences|tenant_classifications|processing_jobs|job_items|audit_logs|source_runs|source_run_files)') ||' outras_funcoes='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname !~ '^tax_')||' outras_policies='||(select count(*) from pg_policies where policyname !~ '^tax_')||' modulo_tabelas='||(select count(*) from pg_tables where schemaname='public' and tablename ~ '^tax_' and tablename <> 'tax_cash_events' and tablename !~ '^tax_cash')||' modulo_funcoes='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^tax_')||' modulo_policies='||(select count(*) from pg_policies where policyname ~ '^tax_')||' buckets='||(select count(*) from storage.buckets where id like 'tax-%')||' hist='||(select count(*) from supabase_migrations.schema_migrations);
rollback;
