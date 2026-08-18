-- 0081_new_job_kinds.sql — ESPELHO da migration aplicada no banco pelo Diogo.
-- Reescreve enqueue_job para aceitar os quatro tipos novos de trabalho:
-- cnpj_sync, sync_rtc_tables, fetch_apuracao e validate_xml.
-- Sem isto, num ambiente novo o botão "Consultar Receita" da tela de Apuração quebra
-- com "unknown job kind fetch_apuracao". Extraído de pg_get_functiondef.

create or replace function public.enqueue_job(p_tenant uuid, p_kind text, p_params jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
end $function$;

-- job_kind_allowed no estado atual do banco (guardas por has_role, sem NULL silencioso)
create or replace function public.job_kind_allowed(p_tenant uuid, p_kind text)
returns boolean
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
begin
  if not in_scope(p_tenant) then return false; end if;
  if is_platform() then return true; end if;
  if p_kind = 'reprocess_rules' then
    return false;
  elsif p_kind = 'price_scenario' then
    return has_role(p_tenant, array['owner','commercial','channel_admin','channel_analyst']::member_role[]);
  elsif p_kind in ('ingest_dfe','classify_chain','compute_taxes','project_cash','regime_sim','bank_sync','ingest_erp') then
    return has_role(p_tenant, array['owner','finance','channel_admin','channel_analyst']::member_role[]);
  end if;
  return false;
end $function$;

revoke execute on function public.job_kind_allowed(uuid, text) from anon, authenticated;
grant execute on function public.enqueue_job(uuid, text, jsonb) to authenticated;
