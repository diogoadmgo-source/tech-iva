-- Migration 20260817175812 (0005_audit) — exportada de supabase_migrations.schema_migrations
create or replace function log_audit(p_tenant uuid, p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_rule uuid default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_claims jsonb := nullif(current_setting('request.jwt.claims',true),'')::jsonb;
        v_headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
begin
  insert into audit_log (tenant_id,actor_id,actor_role,impersonated_by,action,entity,entity_id,before,after,rule_version_id,ip,user_agent)
  values (p_tenant, auth.uid(), role_in(p_tenant)::text,
          nullif(v_claims->>'impersonated_by','')::uuid,
          p_action,p_entity,p_entity_id,p_before,p_after,p_rule,
          nullif(split_part(coalesce(v_headers->>'x-forwarded-for',''), ',', 1),'')::inet,
          v_headers->>'user-agent');
end $$;
grant execute on function log_audit(uuid,text,text,text,jsonb,jsonb,uuid) to authenticated;

create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid;
begin
  v_tenant := coalesce( (case when tg_table_name='tenants' then coalesce(new.id,old.id) else coalesce(new.tenant_id,old.tenant_id) end), null);
  perform log_audit(v_tenant, tg_table_name||'.'||lower(tg_op), tg_table_name, coalesce(new.id,old.id)::text, to_jsonb(old), to_jsonb(new));
  return coalesce(new,old);
end $$;
create trigger audit_tenants        after insert or update on tenants        for each row execute function audit_row();
create trigger audit_subscriptions  after insert or update or delete on subscriptions  for each row execute function audit_row();
create trigger audit_rule_versions  after insert or update on rule_versions  for each row execute function audit_row();
create trigger audit_api_keys       after insert or update on api_keys       for each row execute function audit_row();
