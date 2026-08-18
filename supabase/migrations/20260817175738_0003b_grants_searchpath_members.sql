-- Migration 20260817175738 (0003b_grants_searchpath_members) — exportada de supabase_migrations.schema_migrations
grant usage on schema public to authenticated, service_role;

grant select, insert, update          on public.tenants       to authenticated;
grant select, insert, update          on public.profiles      to authenticated;
grant select, insert, update, delete  on public.memberships   to authenticated;
grant select, insert, update, delete  on public.invitations   to authenticated;
grant select, insert, update, delete  on public.plans         to authenticated;
grant select, insert, update, delete  on public.subscriptions to authenticated;
grant select, insert, update, delete  on public.rule_versions to authenticated;
grant select, insert, update, delete  on public.api_keys      to authenticated;
grant select                          on public.audit_log     to authenticated;

grant all on public.tenants, public.profiles, public.memberships, public.invitations,
             public.plans, public.subscriptions, public.rule_versions, public.api_keys,
             public.audit_log
  to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke update, delete on public.audit_log from authenticated;
revoke all on public.audit_log from anon;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into profiles (user_id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create or replace function role_requires_mfa(p_role member_role) returns boolean
language sql immutable as $$
  select p_role is not null and (p_role::text like 'platform%' or p_role = 'channel_admin');
$$;

create or replace function current_aal() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1');
$$;

create or replace function enforce_mfa(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if role_requires_mfa(role_in(p_tenant)) and current_aal() <> 'aal2' then
    raise exception 'MFA required';
  end if;
end $$;

grant execute on function role_requires_mfa(member_role), current_aal(), enforce_mfa(uuid) to authenticated;

create or replace function tenant_members(p_tenant uuid)
returns table (tenant_id uuid, user_id uuid, role member_role, created_at timestamptz,
               full_name text, avatar_url text, email text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select m.tenant_id, m.user_id, m.role, m.created_at, p.full_name, p.avatar_url, u.email::text
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.user_id = m.user_id
  where m.tenant_id = p_tenant;
end $$;

grant execute on function tenant_members(uuid) to authenticated;
