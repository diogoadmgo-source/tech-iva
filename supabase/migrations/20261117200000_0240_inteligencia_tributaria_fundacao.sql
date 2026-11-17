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
