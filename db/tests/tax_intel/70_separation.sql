-- Separação física público × privado e endurecimento das funções (catálogo).
select set_config('t.suite', 'separacao_catalogo', false);

create temp table pub(t text);
insert into pub values ('tax_sources'), ('tax_entities'), ('tax_consultations'), ('tax_regimes'),
  ('tax_regime_history'), ('tax_regime_events'), ('tax_source_runs'), ('tax_source_run_files');
create temp table priv(t text);
insert into priv values ('tax_imports'), ('tax_import_items'), ('tax_relationships'), ('tax_evidences'),
  ('tax_tenant_classifications'), ('tax_processing_jobs'), ('tax_job_items'), ('tax_audit_logs');

select t.eq('nenhuma tabela pública tem coluna de tenant',
  (select count(*) from information_schema.columns c join pub on pub.t = c.table_name
    where c.table_schema = 'public' and c.column_name ilike '%tenant%'), 0::bigint);
select t.eq('toda tabela privada tem tenant_id NOT NULL',
  (select count(*) from priv where not exists (
     select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = priv.t
       and c.column_name = 'tenant_id' and c.is_nullable = 'NO')), 0::bigint);
select t.eq('nenhuma FK sai do plano público para o privado',
  (select count(*) from pg_constraint k
     join pg_class src on src.oid = k.conrelid join pub on pub.t = src.relname
     join pg_class dst on dst.oid = k.confrelid join priv on priv.t = dst.relname
    where k.contype = 'f'), 0::bigint);
select t.eq('RLS ligado nas 16 tabelas do módulo',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'tax\_%' and c.relkind = 'r' and c.relrowsecurity), 16::bigint);
select t.eq('authenticated não tem INSERT/UPDATE/DELETE em nenhuma tabela do módulo',
  (select count(*) from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public' and table_name like 'tax\_%'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')), 0::bigint);
select t.eq('anon não tem privilégio em nenhuma tabela do módulo',
  (select count(*) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public' and table_name like 'tax\_%'), 0::bigint);
select t.eq('anon não executa nenhuma função do módulo',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'tax\_%' and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.eq('toda função security definer do módulo tem search_path fixo',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'tax\_%' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')), 0::bigint);
select t.eq('search_path das funções security definer termina em pg_temp',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'tax\_%' and p.prosecdef
      and not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%pg_temp')), 0::bigint);
select t.ok('funções internas não executáveis por authenticated',
  not has_function_privilege('authenticated', 'public.tax_audit(uuid,text,text,text,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.tax_can_write(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.tax_import_summary(public.tax_imports)', 'execute'));

-- Fontes: só públicas; nada chamado "evidência" vira fonte.
select t.throws('fonte não pública é recusada',
  $$insert into public.tax_sources (code, name, kind, coverage, limitations, status, is_public) values ('privada_x', 'x', 'api', 'x', 'x', 'ativa', false)$$, 'check');
select t.throws('fonte com nome de evidência é recusada',
  $$insert into public.tax_sources (code, name, kind, coverage, limitations, status) values ('evidencia_tenant', 'x', 'api', 'x', 'x', 'ativa')$$, 'check');
select t.eq('IBS/CBS regular catalogado como indisponível',
  (select status from public.tax_sources where code = 'ibs_cbs_regular'), 'indisponivel');
select t.ok('nenhuma fonte marcada como verificada antes de chamada real',
  not exists (select 1 from public.tax_sources where verified_at is not null));

-- Consulta pública só grava fonte do catálogo (FK) e chave no formato da granularidade.
select t.throws('consulta com fonte fora do catálogo é recusada',
  $$insert into public.tax_consultations (source_code, lookup_key, granularity, status) values ('evidencia', '11222333', 'raiz', 'ok')$$, 'foreign key');
select t.throws('consulta por estabelecimento exige CNPJ válido',
  $$insert into public.tax_consultations (source_code, lookup_key, granularity, status) values ('brasilapi_cnpj', '11222333', 'estabelecimento', 'ok')$$, 'key_format');
select t.throws('mesma competência não grava a mesma chave duas vezes',
  $$insert into public.tax_consultations (source_code, dataset_version, lookup_key, granularity, status) values ('receita_simples', '2026-11', '11222333', 'raiz', 'ok')$$, 'duplicate key');
