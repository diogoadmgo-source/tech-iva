-- Migration 20260817180210 (0005c_harden_internal_functions) — exportada de supabase_migrations.schema_migrations
-- Funções internas (chamadas só por triggers ou por outras funções security definer)
-- não podem ser expostas como RPC ao cliente. Em especial log_audit: se ficasse
-- executável por authenticated, qualquer usuário poderia forjar linhas de auditoria.
revoke execute on function log_audit(uuid,text,text,text,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke execute on function audit_row() from public, anon, authenticated;
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function tenants_set_path() from public, anon, authenticated;
revoke execute on function tenants_block_reparent() from public, anon, authenticated;
revoke execute on function ltree_label(uuid) from public, anon, authenticated;
revoke execute on function enforce_mfa(uuid) from public, anon, authenticated;
revoke execute on function role_requires_mfa(member_role) from public, anon, authenticated;
-- current_aal fica exposta (útil ao front para saber se precisa step-up)
-- Nada de RPC para anon nesta fase
revoke execute on all functions in schema public from anon;
