-- 0141: fecha o resíduo do grant PUBLIC em funções e dá validade ao link público.

-- 1) 29 funções ainda tinham EXECUTE para PUBLIC (logo, para anon).
--    Revoga de public/anon e concede explicitamente a authenticated.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','credit')
      and p.prokind = 'f'
      and exists (
        select 1 from aclexplode(p.proacl) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- Novas funções também não devem nascer executáveis por PUBLIC/anon.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema credit revoke execute on functions from public;

-- 2) Validade do link público de simulação: 90 dias.
alter table public.calc_simulations
  add column if not exists share_expires_at timestamptz;

update public.calc_simulations
  set share_expires_at = created_at + interval '90 days'
  where share_token is not null and share_expires_at is null;

-- share_simulation passa a (re)definir a validade e a devolver token + expiração.
drop function if exists public.share_simulation(uuid);
create or replace function public.share_simulation(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $$
declare v_tenant uuid; v_token text; v_exp timestamptz;
begin
  select tenant_id, share_token, share_expires_at
    into v_tenant, v_token, v_exp
  from calc_simulations where id = p_id;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;

  -- link novo, ou link já vencido: gera token e reinicia os 90 dias
  if v_token is null or v_exp is null or v_exp <= now() then
    v_token := encode(gen_random_bytes(16),'hex');
    v_exp := now() + interval '90 days';
    update calc_simulations
      set share_token = v_token, share_expires_at = v_exp
      where id = p_id;
    perform log_audit(v_tenant,'simulation.share','calc_simulation',p_id::text,null,
                      jsonb_build_object('expires_at', v_exp));
  end if;
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;

revoke all on function public.share_simulation(uuid) from public, anon;
grant execute on function public.share_simulation(uuid) to authenticated;
grant execute on function public.share_simulation(uuid) to service_role;

-- Revogar o compartilhamento (o dono pode cortar o link antes do prazo).
create or replace function public.unshare_simulation(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public','extensions' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from calc_simulations where id = p_id;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;
  update calc_simulations set share_token = null, share_expires_at = null where id = p_id;
  perform log_audit(v_tenant,'simulation.unshare','calc_simulation',p_id::text,null,null);
end $$;

revoke all on function public.unshare_simulation(uuid) from public, anon;
grant execute on function public.unshare_simulation(uuid) to authenticated;
grant execute on function public.unshare_simulation(uuid) to service_role;