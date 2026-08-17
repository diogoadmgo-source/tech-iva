-- 0005c_harden_internal_functions.sql
-- Motivo: o advisor do Supabase apontou que `log_audit` estava exposta como RPC —
-- qualquer usuário logado poderia forjar registros de auditoria.
-- Funções internas (triggers, gates, helpers de path) não devem ser chamáveis pelo cliente.
-- `current_aal()` permanece exposta a `authenticated` (o front precisa dela).

revoke execute on function log_audit(uuid,text,text,text,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke execute on function audit_row()                                    from public, anon, authenticated;
revoke execute on function handle_new_user()                              from public, anon, authenticated;
revoke execute on function tenants_set_path()                             from public, anon, authenticated;
revoke execute on function tenants_block_reparent()                       from public, anon, authenticated;
revoke execute on function ltree_label(uuid)                              from public, anon, authenticated;
revoke execute on function enforce_mfa(uuid)                              from public, anon, authenticated;
revoke execute on function role_requires_mfa(member_role)                 from public, anon, authenticated;

-- Nenhuma função do plano de controle deve ser chamável por visitante anônimo.
revoke execute on all functions in schema public from anon;

-- Mantida para o gate de MFA no front.
grant execute on function current_aal() to authenticated;
