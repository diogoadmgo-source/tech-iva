-- 0001_control_plane.sql
-- FLUXA / TECH-IVA — Fundação, bloco 1.1 do documento 01 (schema do plano de controle)
-- Ordem de aplicação: 0001, 0002, 0003, 0003b, 0004, 0005, 0006.
-- NADA aplicado ainda: arquivo preparado para rodar no projeto Supabase externo (fluxa-dev).

create extension if not exists ltree;
create extension if not exists pgcrypto;
create extension if not exists citext;

-- Enums
create type tenant_kind as enum ('platform','channel','company','unit');
create type tenant_status as enum ('active','suspended','archived');
create type member_role as enum (
  'platform_admin','platform_ops','platform_risk',   -- nível 0
  'channel_admin','channel_analyst',                 -- nível 1
  'owner','finance','commercial','viewer'            -- níveis 2 e 3
);
create type invite_status as enum ('pending','accepted','expired','revoked');

-- Tenants (árvore recursiva)
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references tenants(id) on delete restrict,
  path          ltree not null,                 -- preenchido por trigger
  level         smallint not null,              -- 0..N, preenchido por trigger
  kind          tenant_kind not null,
  name          text not null,
  slug          citext unique,                  -- para white-label / URL do canal
  cnpj          text,                           -- obrigatório se kind in (company, unit)
  brand         jsonb not null default '{}',    -- {logo_url, primary, accent, domain}
  settings      jsonb not null default '{}',
  status        tenant_status not null default 'active',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tenants_cnpj_required check (kind in ('platform','channel') or cnpj is not null),
  constraint tenants_root_once check (kind <> 'platform' or parent_id is null)
);
create index tenants_path_gist on tenants using gist (path);
create index tenants_parent on tenants (parent_id);
create unique index tenants_cnpj_unique on tenants (cnpj) where cnpj is not null and kind = 'company';

-- Perfis (espelho de auth.users com dados de app)
create table profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  phone       text,
  locale      text not null default 'pt-BR',
  last_tenant uuid references tenants(id),     -- último tenant ativo (UX)
  created_at  timestamptz not null default now()
);

-- Vínculo usuário × tenant × papel
create table memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  role       member_role not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index memberships_tenant on memberships (tenant_id);

-- Convites
create table invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       citext not null,
  role        member_role not null,
  token_hash  text not null unique,           -- sha256 do token enviado por e-mail
  status      invite_status not null default 'pending',
  invited_by  uuid not null,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_by uuid,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index invitations_tenant on invitations (tenant_id, status);

-- Planos e assinaturas
create table plans (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,           -- starter | pro | scale | channel
  name        text not null,
  price_cents bigint not null default 0,
  limits      jsonb not null default '{}',    -- {companies, users, invoices_month}
  features    jsonb not null default '{}',    -- {pricing:true, credit:false ...}
  active      boolean not null default true
);
create table subscriptions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  plan_id     uuid not null references plans(id),
  status      text not null default 'trialing', -- trialing|active|past_due|canceled
  started_at  timestamptz not null default now(),
  ends_at     timestamptz,
  meta        jsonb not null default '{}'
);
create index subscriptions_tenant on subscriptions (tenant_id);

-- Versões de regra (calculadora + tabelas)
create table rule_versions (
  id                 uuid primary key default gen_random_uuid(),
  calc_version       text not null,
  cclasstrib_version text not null,
  valid_from         date not null,
  published_by       uuid,
  published_at       timestamptz,
  notes              text,
  is_current         boolean not null default false
);
create unique index rule_versions_current on rule_versions (is_current) where is_current;

-- Chaves de API por tenant (fase 02)
create table api_keys (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  key_hash    text not null unique,
  scopes      text[] not null default '{}',
  created_by  uuid not null,
  last_used   timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Auditoria (append-only)
create table audit_log (
  id              bigserial primary key,
  tenant_id       uuid,
  actor_id        uuid,
  actor_role      text,
  impersonated_by uuid,                       -- se platform impersonando
  action          text not null,              -- tenant.create, membership.update, rule.publish...
  entity          text not null,
  entity_id       text,
  before          jsonb,
  after           jsonb,
  rule_version_id uuid,
  ip              inet,
  user_agent      text,
  at              timestamptz not null default now()
);
create index audit_tenant_at on audit_log (tenant_id, at desc);
revoke update, delete on audit_log from anon, authenticated;
