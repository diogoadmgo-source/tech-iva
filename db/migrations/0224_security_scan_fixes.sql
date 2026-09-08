-- 0224_security_scan_fixes.sql — ESPELHO da migration aplicada no banco.
--
-- 1) audit_overview(uuid,date) nasceu (depois da 0210) com EXECUTE para PUBLIC,
--    logo chamável pelo papel anon. Revoga de PUBLIC/anon e reconcede a
--    authenticated/service_role. Varredura genérica para pegar qualquer outra
--    função SECURITY DEFINER na mesma situação.
-- 2) v_audit_resumo era avaliada com os privilégios do criador (default do
--    Postgres). Passa a security_invoker: a RLS de audit_findings é aplicada
--    para quem consulta.
-- 3) calc_classtrib_matriz / calc_classtrib_aplicavel (dados de referência da
--    matriz CST × cClassTrib) estavam sem RLS. Liga RLS com leitura para
--    authenticated e nenhuma escrita direta (só service_role).
-- 4) audit_findings: políticas estavam `to public` (inclui anon). Recria
--    `to authenticated`.

-- 1) EXECUTE para PUBLIC em funções SECURITY DEFINER
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','credit')
      and p.prokind = 'f'
      and exists (select 1 from aclexplode(p.proacl) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 2) view avaliada como quem consulta
alter view public.v_audit_resumo set (security_invoker = on);
revoke all on public.v_audit_resumo from anon;
grant select on public.v_audit_resumo to authenticated;
grant select on public.v_audit_resumo to service_role;

-- 3) RLS nas tabelas de referência da matriz
alter table public.calc_classtrib_matriz    enable row level security;
alter table public.calc_classtrib_aplicavel enable row level security;

revoke all on public.calc_classtrib_matriz    from anon;
revoke all on public.calc_classtrib_aplicavel from anon;
revoke insert, update, delete, truncate on public.calc_classtrib_matriz    from authenticated;
revoke insert, update, delete, truncate on public.calc_classtrib_aplicavel from authenticated;
grant select on public.calc_classtrib_matriz    to authenticated;
grant select on public.calc_classtrib_aplicavel to authenticated;
grant all on public.calc_classtrib_matriz    to service_role;
grant all on public.calc_classtrib_aplicavel to service_role;

drop policy if exists calc_classtrib_matriz_select on public.calc_classtrib_matriz;
create policy calc_classtrib_matriz_select on public.calc_classtrib_matriz
  for select to authenticated using (true);

drop policy if exists calc_classtrib_aplicavel_select on public.calc_classtrib_aplicavel;
create policy calc_classtrib_aplicavel_select on public.calc_classtrib_aplicavel
  for select to authenticated using (true);

-- 4) audit_findings: papel explícito
drop policy if exists audit_findings_read on public.audit_findings;
create policy audit_findings_read on public.audit_findings
  for select to authenticated using (in_scope(tenant_id));

drop policy if exists audit_findings_update on public.audit_findings;
create policy audit_findings_update on public.audit_findings
  for update to authenticated using (can_admin(tenant_id)) with check (can_admin(tenant_id));

revoke all on public.audit_findings from anon;
