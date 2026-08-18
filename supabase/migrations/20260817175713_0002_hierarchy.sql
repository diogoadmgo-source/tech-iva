-- Migration 20260817175713 (0002_hierarchy) — exportada de supabase_migrations.schema_migrations
create or replace function ltree_label(p uuid) returns text
language sql immutable as $$ select 't' || replace(p::text,'-','') $$;

create or replace function tenants_set_path() returns trigger
language plpgsql as $$
declare parent_path ltree; parent_level smallint;
begin
  if new.parent_id is null then
    if new.kind <> 'platform' then raise exception 'only platform tenant can be root'; end if;
    new.path := ltree_label(new.id)::ltree; new.level := 0;
  else
    select path, level into parent_path, parent_level from tenants where id = new.parent_id;
    if parent_path is null then raise exception 'parent not found'; end if;
    new.path := parent_path || ltree_label(new.id); new.level := parent_level + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_tenants_path before insert on tenants for each row execute function tenants_set_path();

create or replace function tenants_block_reparent() returns trigger language plpgsql as $$
begin
  if new.parent_id is distinct from old.parent_id then
    raise exception 'use move_tenant() to change parent';
  end if;
  new.path := old.path; new.level := old.level; new.updated_at := now();
  return new;
end $$;
create trigger trg_tenants_reparent before update on tenants for each row execute function tenants_block_reparent();

create or replace function auth_scopes() returns ltree[]
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(array_agg(t.path), '{}')
  from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and t.status = 'active';
$$;

create or replace function in_scope(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from tenants t where t.id = p_tenant and t.path <@ any(auth_scopes()));
$$;

create or replace function role_in(p_tenant uuid) returns member_role
language sql stable security definer set search_path = public, extensions as $$
  select m.role
  from tenants target
  join tenants anc on target.path <@ anc.path
  join memberships m on m.tenant_id = anc.id and m.user_id = auth.uid()
  where target.id = p_tenant
  order by anc.level desc limit 1;
$$;

create or replace function is_platform() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from memberships m join tenants t on t.id=m.tenant_id
                 where m.user_id = auth.uid() and t.kind='platform');
$$;

create or replace function can_admin(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(role_in(p_tenant) in ('platform_admin','channel_admin','owner'), false);
$$;

grant execute on function auth_scopes(), in_scope(uuid), role_in(uuid), is_platform(), can_admin(uuid) to authenticated;
