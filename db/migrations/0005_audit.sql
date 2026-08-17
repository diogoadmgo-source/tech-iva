-- 0005_audit.sql
-- Bloco 1.6 do documento 01 — auditoria append-only.

create or replace function log_audit(p_tenant uuid, p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_rule uuid default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into audit_log (tenant_id,actor_id,actor_role,impersonated_by,action,entity,entity_id,before,after,rule_version_id,ip,user_agent)
  values (p_tenant, auth.uid(), role_in(p_tenant)::text,
          nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'impersonated_by','')::uuid,
          p_action,p_entity,p_entity_id,p_before,p_after,p_rule,
          nullif(split_part(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for',''), ',', 1),'')::inet,
          nullif(current_setting('request.headers',true),'')::jsonb->>'user-agent');
end $$;
grant execute on function log_audit(uuid,text,text,text,jsonb,jsonb,uuid) to authenticated;

-- Trigger genérico para tabelas sensíveis (tenants, subscriptions, rule_versions, api_keys)
-- audit_row() lê as colunas via jsonb: o plpgsql valida `new.tenant_id` mesmo no
-- ramo não executado do CASE, e o record de `tenants` não tem essa coluna (o seed quebrava).
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old)); v_tenant uuid;
begin
  v_tenant := case when tg_table_name='tenants' then (v_row->>'id')::uuid else (v_row->>'tenant_id')::uuid end;
  perform log_audit(v_tenant, tg_table_name||'.'||lower(tg_op), tg_table_name, v_row->>'id', to_jsonb(old), to_jsonb(new));
  return coalesce(new,old);
end $$;
create trigger audit_tenants        after insert or update on tenants        for each row execute function audit_row();
create trigger audit_subscriptions  after insert or update or delete on subscriptions  for each row execute function audit_row();
create trigger audit_rule_versions  after insert or update on rule_versions  for each row execute function audit_row();
create trigger audit_api_keys       after insert or update on api_keys       for each row execute function audit_row();
