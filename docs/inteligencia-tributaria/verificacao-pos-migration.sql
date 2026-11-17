-- Verificação depois do `supabase db push` no TechIVA-Prod (lfufwoirpwlsdmststbr).
-- SOMENTE LEITURA. Cada linha traz o valor encontrado e o esperado.

with
hist as (
  select count(*) n, max(version) ultima,
         count(*) filter (where version in ('20260926030000', '20261117200000', '20261117200100')) novas
    from supabase_migrations.schema_migrations),
tabelas as (
  select c.relname, c.relrowsecurity rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname in (
     'tax_sources', 'tax_entities', 'tax_consultations', 'tax_regimes', 'tax_regime_history',
     'tax_regime_events', 'tax_imports', 'tax_import_items', 'tax_relationships', 'tax_evidences',
     'tax_tenant_classifications', 'tax_processing_jobs', 'tax_job_items', 'tax_audit_logs',
     'tax_source_runs', 'tax_source_run_files', 'rtc_webhook_recebido')),
grants as (
  select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name in (select relname from tabelas)
     and grantee in ('anon', 'authenticated')
   group by 1, 2),
funcs as (
  select p.oid::regprocedure::text sig, p.prosecdef sd,
         has_function_privilege('anon', p.oid, 'execute') anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname in ('tax_audit', 'tax_block_mutation', 'tax_can_read_audit', 'tax_can_read_evidence_file',
            'tax_can_read_import_file', 'tax_can_upload_evidence', 'tax_can_upload_import', 'tax_can_write',
            'tax_cnpj_is_valid', 'tax_cnpj_strip', 'tax_evidences_guard', 'tax_import_add_items',
            'tax_import_cancel', 'tax_import_create', 'tax_import_finalize', 'tax_import_summary',
            'tax_is_platform_manager', 'tax_key_visible', 'tax_parse_relationship', 'tax_regimes_guard',
            'tax_scope_tenants', 'tax_storage_tenant')
          or p.proname in ('rtc_apuracao_receber_tiquete', 'rtc_apuracao_expirar_pendentes')))
select 'historico' item, format('%s versões, última %s, novas %s', n, ultima, novas) encontrado,
       '141 versões, última 20261117200100, novas 3' esperado from hist
union all
select 'tabelas', format('%s tabelas, %s com RLS', count(*), count(*) filter (where rls)), '17 tabelas, 17 com RLS' from tabelas
union all
select 'grants anon', coalesce(string_agg(table_name || ':' || privs, ' '), 'nenhum'), 'nenhum'
  from grants where grantee = 'anon'
union all
select 'grants authenticated fora de SELECT', coalesce(string_agg(table_name || ':' || privs, ' '), 'nenhum'), 'nenhum'
  from grants where grantee = 'authenticated' and privs <> 'SELECT'
union all
select 'authenticated em rtc_webhook_recebido', coalesce((select privs from grants where grantee = 'authenticated' and table_name = 'rtc_webhook_recebido'), 'nenhum'), 'nenhum'
union all
select 'funções', format('%s funções', count(*)), '24 funções (22 tax_* + 2 rtc_*)' from funcs
union all
select 'funções executáveis por anon', coalesce(string_agg(sig, ' ') filter (where anon_x), 'nenhuma'), 'nenhuma' from funcs
union all
select 'internas executáveis por authenticated',
       coalesce(string_agg(sig, ' ') filter (where auth_x and (sig ~ '^(tax_audit|tax_block_mutation|tax_regimes_guard|tax_evidences_guard|tax_can_write|tax_import_summary|rtc_)')), 'nenhuma'),
       'nenhuma' from funcs
union all
select 'assinatura receber_tiquete', string_agg(sig, ' ') filter (where sig like 'rtc_apuracao_receber_tiquete%'),
       'rtc_apuracao_receber_tiquete(text,jsonb,jsonb)' from funcs
union all
select 'janela 24h', (pg_get_functiondef('public.rtc_apuracao_expirar_pendentes()'::regprocedure) like '%24 hours%')::text, 'true'
union all
select 'policies das tabelas', count(*)::text, '16' from pg_policies
 where schemaname = 'public' and tablename in (select relname from tabelas) and tablename <> 'rtc_webhook_recebido'
union all
select 'policies em rtc_webhook_recebido', count(*)::text, '0' from pg_policies
 where schemaname = 'public' and tablename = 'rtc_webhook_recebido'
union all
select 'policies do Storage', string_agg(policyname || '(' || cmd || ')', ' ' order by policyname),
       'tax_evidences_download(SELECT) tax_evidences_upload(INSERT) tax_imports_download(SELECT) tax_imports_upload(INSERT)'
  from pg_policies where schemaname = 'storage' and policyname like 'tax\_%'
union all
select 'buckets', string_agg(id || ' public=' || public || ' limite=' || file_size_limit, ' ' order by id),
       'tax-evidences public=false limite=20971520 tax-imports public=false limite=31457280'
  from storage.buckets where id like 'tax-%'
union all
select 'triggers de imutabilidade', count(*)::text, '11' from pg_trigger
 where not tgisinternal and tgname ~ '^tax_.*(_immutable|_no_truncate|_guard)$'
union all
select 'catálogo de fontes', count(*)::text, '6' from public.tax_sources
union all
select 'dados do módulo', (select count(*) from public.tax_entities) + (select count(*) from public.tax_relationships) + (select count(*) from public.tax_imports) || ' linhas', '0 linhas';
