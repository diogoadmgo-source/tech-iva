-- Ambiente mínimo do Supabase para testar as migrations 0240+ num Postgres
-- descartável (local ou CI). SÓ PARA TESTE: nunca rode isto no Supabase.
--
-- As funções de escopo (auth_scopes, in_scope, role_in, has_role, log_audit,
-- tenants_set_path) são cópia literal das definições lidas do banco em uso
-- (fluxa-dev) em 17/11/2026 via pg_get_functiondef. As tabelas trazem só as
-- colunas que essas funções e o módulo usam.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
create extension if not exists ltree schema extensions;
create extension if not exists citext schema extensions;
create extension if not exists pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- auth -----------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- control plane ------------------------------------------------------------------
set search_path = public, extensions;
create type tenant_kind as enum ('platform', 'channel', 'company', 'unit');
create type tenant_status as enum ('active', 'suspended', 'archived');
create type member_role as enum ('platform_admin', 'platform_ops', 'platform_risk', 'channel_admin',
                                 'channel_analyst', 'owner', 'finance', 'commercial', 'viewer');
create table tenants (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references tenants(id) on delete restrict,
  path ltree not null,
  level smallint not null,
  kind tenant_kind not null,
  name text not null,
  cnpj text,
  status tenant_status not null default 'active',
  updated_at timestamptz not null default now()
);
create table memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role member_role not null,
  primary key (user_id, tenant_id)
);
create table audit_log (
  id bigserial primary key, tenant_id uuid, actor_id uuid, actor_role text, impersonated_by uuid,
  action text not null, entity text not null, entity_id text, before jsonb, after jsonb,
  rule_version_id uuid, ip inet, user_agent text, at timestamptz not null default now()
);
grant select on tenants, memberships to authenticated;

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

CREATE OR REPLACE FUNCTION public.auth_scopes()
 RETURNS ltree[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select coalesce(array_agg(t.path), '{}')
  from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and t.status = 'active';
$function$;

CREATE OR REPLACE FUNCTION public.in_scope(p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select exists (select 1 from tenants t where t.id = p_tenant and t.path <@ any(auth_scopes()));
$function$;

CREATE OR REPLACE FUNCTION public.role_in(p_tenant uuid)
 RETURNS member_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select m.role
  from tenants target
  join tenants anc on target.path <@ anc.path
  join memberships m on m.tenant_id = anc.id and m.user_id = auth.uid()
  where target.id = p_tenant
  order by anc.level desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(p_tenant uuid, p_roles member_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select coalesce(role_in(p_tenant) = any(p_roles), false);
$function$;

CREATE OR REPLACE FUNCTION public.log_audit(p_tenant uuid, p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_rule uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_claims jsonb := nullif(current_setting('request.jwt.claims',true),'')::jsonb;
        v_headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
begin
  insert into audit_log (tenant_id,actor_id,actor_role,impersonated_by,action,entity,entity_id,before,after,rule_version_id,ip,user_agent)
  values (p_tenant, auth.uid(), role_in(p_tenant)::text,
          nullif(v_claims->>'impersonated_by','')::uuid,
          p_action,p_entity,p_entity_id,p_before,p_after,p_rule,
          nullif(split_part(coalesce(v_headers->>'x-forwarded-for',''), ',', 1),'')::inet,
          v_headers->>'user-agent');
end $function$;

-- Privilégios como no banco real (0030 / 0005c).
revoke execute on function has_role(uuid, member_role[]) from public, anon, authenticated;
revoke execute on function ltree_label(uuid) from public, anon, authenticated;
grant execute on function in_scope(uuid), role_in(uuid), auth_scopes() to authenticated;

-- storage --------------------------------------------------------------------------
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- Privilégios padrão do Supabase em tabelas e funções novas do schema public
-- (o que torna obrigatório o "revoke all" das migrations).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

reset search_path;
