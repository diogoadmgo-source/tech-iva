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

begin;

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

commit;
