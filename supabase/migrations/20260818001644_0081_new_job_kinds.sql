-- Migration 20260818001644 (0081_new_job_kinds) — exportada de supabase_migrations.schema_migrations
-- Novos tipos de job para as frentes de integração
create or replace function enqueue_job(p_tenant uuid, p_kind text, p_params jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_role member_role;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  v_role := role_in(p_tenant);
  if not coalesce(v_role in ('platform_admin','platform_ops','channel_admin','channel_analyst',
                             'owner','finance','commercial'), false) then
    raise exception 'forbidden';
  end if;
  if p_kind not in ('ingest_dfe','classify_chain','compute_taxes','project_cash','price_scenario',
                    'regime_sim','reprocess_rules','bank_sync',
                    -- novos:
                    'cnpj_sync',        -- busca cadastros faltantes da carteira
                    'sync_rtc_tables',  -- baixa matriz CST x cClassTrib dos dados abertos
                    'fetch_apuracao',   -- apuração assistida (respeita cota 2/dia por CNPJ)
                    'validate_xml') then -- assistente validador da calculadora oficial
    raise exception 'unknown job kind %', p_kind;
  end if;
  insert into jobs (tenant_id, kind, params, requested_by)
  values (p_tenant, p_kind, coalesce(p_params,'{}'), auth.uid()) returning id into v_id;
  perform log_audit(p_tenant,'job.enqueue','job',v_id::text,null,jsonb_build_object('kind',p_kind,'params',p_params));
  return v_id;
end $$;
grant execute on function enqueue_job(uuid,text,jsonb) to authenticated;
