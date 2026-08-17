-- 0013_revoke_public_execute.sql
-- `grant execute ... to public` (default do Postgres em create function) fazia com que
-- anon continuasse podendo executar RPCs SECURITY DEFINER. Revoga de PUBLIC/anon
-- e concede explicitamente só a `authenticated` nas RPCs que o front usa.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

grant execute on function public.current_aal() to authenticated;
grant execute on function public.ack_alert(uuid) to authenticated;
grant execute on function public.resolve_alert(uuid, text) to authenticated;
grant execute on function public.dashboard_cash(uuid, integer) to authenticated;
grant execute on function public.chain_map(uuid, party_role, jsonb) to authenticated;
grant execute on function public.channel_portfolio(uuid, jsonb) to authenticated;
grant execute on function public.counterparty_detail(uuid, uuid) to authenticated;
