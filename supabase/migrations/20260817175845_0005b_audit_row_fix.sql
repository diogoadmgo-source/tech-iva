-- Migration 20260817175845 (0005b_audit_row_fix) — exportada de supabase_migrations.schema_migrations
-- audit_row: acesso a colunas via jsonb (o record NEW de tenants não tem tenant_id
-- e o plpgsql valida a referência mesmo no ramo não executado do CASE)
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old)); v_tenant uuid;
begin
  v_tenant := case when tg_table_name='tenants' then (v_row->>'id')::uuid else (v_row->>'tenant_id')::uuid end;
  perform log_audit(v_tenant, tg_table_name||'.'||lower(tg_op), tg_table_name, v_row->>'id', to_jsonb(old), to_jsonb(new));
  return coalesce(new,old);
end $$;
