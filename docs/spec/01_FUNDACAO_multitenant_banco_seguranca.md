# 01 — FUNDAÇÃO: multi-tenant, banco, segurança, login e gestão de usuários

> Objetivo desta fase: uma base onde **qualquer** empresa, canal ou unidade pode ser criada em qualquer ponto da árvore, com isolamento garantido pelo banco (não pelo front), login pronto, convites, papéis e auditoria. Nada de negócio ainda. Se esta fase sair certa, todo o resto encaixa; se sair errada, nada em cima dela é confiável.

Blocos: 1.1 schema · 1.2 hierarquia e escopo · 1.3 RLS · 1.4 Auth e perfis · 1.5 convites e papéis · 1.6 auditoria · 1.7 gestão no Lovable · 1.8 testes de aceite.

Convenções: schema `public` para o plano de controle; `credit` para o crédito (fase 6); nomes em inglês no banco, PT-BR na interface. Migrations numeradas `0001_...sql`.

---

## 1.1 Schema do plano de controle (migration 0001)

```sql
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
  cnpj          text,                            -- obrigatório se kind in (company, unit)
  brand         jsonb not null default '{}',     -- {logo_url, primary, accent, domain}
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
  limits      jsonb not null default '{}',     -- {companies, users, invoices_month}
  features    jsonb not null default '{}',     -- {pricing:true, credit:false ...}
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
```

**Aceite 1.1:** migration aplica sem erro; `\d tenants` mostra path/level; inserir company sem cnpj falha; inserir 2 companies com mesmo cnpj falha.

---

## 1.2 Hierarquia e escopo (migration 0002)

```sql
-- Label ltree seguro a partir do uuid
create or replace function ltree_label(p uuid) returns text
language sql immutable as $$ select 't' || replace(p::text,'-','') $$;

-- Trigger: preenche path e level
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

-- Proibir reparenting silencioso (mover subárvore só por RPC dedicada)
create or replace function tenants_block_reparent() returns trigger language plpgsql as $$
begin
  if new.parent_id is distinct from old.parent_id then
    raise exception 'use move_tenant() to change parent';
  end if;
  new.path := old.path; new.level := old.level; new.updated_at := now();
  return new;
end $$;
create trigger trg_tenants_reparent before update on tenants for each row execute function tenants_block_reparent();

-- Escopos do usuário logado: caminhos dos tenants em que tem membership
create or replace function auth_scopes() returns ltree[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t.path), '{}')
  from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and t.status = 'active';
$$;

-- Está no escopo? (nó ou descendente)
create or replace function in_scope(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tenants t where t.id = p_tenant and t.path <@ any(auth_scopes()));
$$;

-- Papel do usuário num tenant (herdado do ancestral mais próximo em que tem membership)
create or replace function role_in(p_tenant uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select m.role
  from tenants target
  join tenants anc on target.path <@ anc.path
  join memberships m on m.tenant_id = anc.id and m.user_id = auth.uid()
  where target.id = p_tenant
  order by anc.level desc limit 1;
$$;

create or replace function is_platform() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join tenants t on t.id=m.tenant_id
                 where m.user_id = auth.uid() and t.kind='platform');
$$;

-- Pode administrar (criar filhos, convidar, editar) este tenant?
create or replace function can_admin(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(role_in(p_tenant) in ('platform_admin','channel_admin','owner'), false);
$$;

grant execute on function auth_scopes(), in_scope(uuid), role_in(uuid), is_platform(), can_admin(uuid) to authenticated;
```

**Aceite 1.2:** criar platform → channel → company → unit produz `path` de 4 labels e `level` 0..3; `update tenants set parent_id=…` falha; `role_in(unit)` de um usuário com membership só no channel devolve `channel_admin`.

---

## 1.3 RLS do plano de controle (migration 0003)

```sql
alter table tenants        enable row level security;
alter table profiles       enable row level security;
alter table memberships    enable row level security;
alter table invitations    enable row level security;
alter table plans          enable row level security;
alter table subscriptions  enable row level security;
alter table rule_versions  enable row level security;
alter table api_keys       enable row level security;
alter table audit_log      enable row level security;

-- tenants: leitura no escopo; criação sob um pai administrável; edição por admin do nó
create policy tenants_select on tenants for select to authenticated using (in_scope(id));
create policy tenants_insert on tenants for insert to authenticated with check (parent_id is not null and can_admin(parent_id));
create policy tenants_update on tenants for update to authenticated using (can_admin(id)) with check (can_admin(id));
-- delete: nunca via cliente (arquivar por status)

-- profiles: o próprio, e quem compartilha tenant enxerga nome/avatar via view
create policy profiles_self_select on profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_self_update on profiles for update to authenticated using (user_id = auth.uid());
create policy profiles_self_insert on profiles for insert to authenticated with check (user_id = auth.uid());

-- memberships: ver as do escopo; criar/alterar/remover só admin do tenant; ninguém remove o último owner (trigger)
create policy memberships_select on memberships for select to authenticated using (user_id = auth.uid() or in_scope(tenant_id));
create policy memberships_write  on memberships for all    to authenticated using (can_admin(tenant_id)) with check (can_admin(tenant_id));

-- invitations: escopo + admin
create policy invitations_select on invitations for select to authenticated using (in_scope(tenant_id));
create policy invitations_write  on invitations for all    to authenticated using (can_admin(tenant_id)) with check (can_admin(tenant_id));

-- plans: todos leem ativos; só platform escreve
create policy plans_select on plans for select to authenticated using (active or is_platform());
create policy plans_write  on plans for all to authenticated using (is_platform()) with check (is_platform());

-- subscriptions: escopo lê; platform e channel_admin do ancestral escrevem
create policy subs_select on subscriptions for select to authenticated using (in_scope(tenant_id));
create policy subs_write  on subscriptions for all to authenticated using (is_platform() or role_in(tenant_id)='channel_admin') with check (is_platform() or role_in(tenant_id)='channel_admin');

-- rule_versions: todos leem; só platform escreve
create policy rules_select on rule_versions for select to authenticated using (true);
create policy rules_write  on rule_versions for all to authenticated using (is_platform()) with check (is_platform());

-- api_keys: admin do tenant
create policy apikeys_all on api_keys for all to authenticated using (can_admin(tenant_id)) with check (can_admin(tenant_id));

-- audit_log: leitura no escopo; escrita só por função (security definer)
create policy audit_select on audit_log for select to authenticated using (tenant_id is null and is_platform() or in_scope(tenant_id));

-- View segura de membros (nome/e-mail sem expor profiles inteiros)
create or replace view v_tenant_members with (security_invoker = true) as
select m.tenant_id, m.user_id, m.role, m.created_at, p.full_name, p.avatar_url, u.email
from memberships m join profiles p on p.user_id = m.user_id join auth.users u on u.id = m.user_id;
grant select on v_tenant_members to authenticated;
```

**Regra de ouro:** nenhuma política usa `true` para escrita. Nenhum `delete` liberado ao cliente em tenants/memberships (soft-delete/arquivar).

**Aceite 1.3:** ver 1.8 (matriz de testes).

---

## 1.4 Auth, perfis e sessão (Supabase Auth + Lovable)

**Provedores:** e-mail/senha e magic link (fase 1); Google OAuth (fase 1, opcional); SSO SAML para canais grandes (fase 7).

**Regras:**
- Confirmação de e-mail obrigatória. Senha mínima 10 caracteres.
- Trigger `on auth.users insert` cria `profiles`.
- MFA (TOTP) obrigatório para papéis `platform_*` e `channel_admin`; opcional para os demais (Supabase Auth MFA; o front bloqueia rotas de admin se `aal < aal2`).
- Sessão: refresh padrão do Supabase; logout global em troca de senha.
- **Tenant ativo:** o front mantém `activeTenantId` (URL `/t/:tenantSlug/...` ou store), grava em `profiles.last_tenant`. RLS não depende disso — é só UX. Toda query filtra `tenant_id = activeTenantId` **além** da RLS.
- **Impersonação (nível 0):** RPC `start_impersonation(user_id)` que registra em `audit_log` e devolve um token de curta duração (Edge Function com service role); banner vermelho fixo no front enquanto ativo.

```sql
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
```

**Aceite 1.4:** cadastro → e-mail de confirmação → login → perfil criado; login sem MFA em conta `platform_admin` não abre o painel da plataforma; troca de senha derruba outras sessões.

---

## 1.5 Convites, papéis e ciclo de vida (migration 0004)

```sql
-- Convidar (gera token; o e-mail é enviado por Edge Function que lê o token retornado)
create or replace function invite_user(p_tenant uuid, p_email citext, p_role member_role)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = public as $$
declare v_token text := encode(gen_random_bytes(24),'hex'); v_id uuid;
begin
  if not can_admin(p_tenant) then raise exception 'forbidden'; end if;
  -- papel compatível com o tipo do tenant
  if (select kind from tenants where id=p_tenant)='platform' and p_role not like 'platform_%' then raise exception 'invalid role for platform'; end if;
  if (select kind from tenants where id=p_tenant)='channel'  and p_role not like 'channel_%'  then raise exception 'invalid role for channel'; end if;
  if (select kind from tenants where id=p_tenant) in ('company','unit') and p_role not in ('owner','finance','commercial','viewer') then raise exception 'invalid role for company'; end if;

  insert into invitations (tenant_id,email,role,token_hash,invited_by)
  values (p_tenant,p_email,p_role,encode(digest(v_token,'sha256'),'hex'),auth.uid())
  returning id into v_id;
  perform log_audit(p_tenant,'invitation.create','invitation',v_id::text,null,jsonb_build_object('email',p_email,'role',p_role));
  return query select v_id, v_token;
end $$;

-- Aceitar (usuário já logado com o mesmo e-mail)
create or replace function accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v inv record; v_email citext;
begin
  select * into v from invitations where token_hash = encode(digest(p_token,'sha256'),'hex') and status='pending' and expires_at>now();
  if v is null then raise exception 'invalid or expired invitation'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email <> v.email then raise exception 'invitation email mismatch'; end if;
  insert into memberships (user_id,tenant_id,role,created_by) values (auth.uid(),v.tenant_id,v.role,v.invited_by)
    on conflict (user_id,tenant_id) do update set role = excluded.role;
  update invitations set status='accepted', accepted_by=auth.uid(), accepted_at=now() where id=v.id;
  perform log_audit(v.tenant_id,'invitation.accept','membership',auth.uid()::text,null,jsonb_build_object('role',v.role));
  return v.tenant_id;
end $$;

-- Alterar papel / remover membro
create or replace function set_member_role(p_tenant uuid, p_user uuid, p_role member_role) returns void
language plpgsql security definer set search_path = public as $$
declare v_old member_role;
begin
  if not can_admin(p_tenant) then raise exception 'forbidden'; end if;
  select role into v_old from memberships where tenant_id=p_tenant and user_id=p_user;
  update memberships set role=p_role where tenant_id=p_tenant and user_id=p_user;
  perform log_audit(p_tenant,'membership.role','membership',p_user::text,jsonb_build_object('role',v_old),jsonb_build_object('role',p_role));
end $$;

create or replace function remove_member(p_tenant uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_admin(p_tenant) then raise exception 'forbidden'; end if;
  if (select count(*) from memberships where tenant_id=p_tenant and role in ('owner','channel_admin','platform_admin')) = 1
     and (select role from memberships where tenant_id=p_tenant and user_id=p_user) in ('owner','channel_admin','platform_admin') then
    raise exception 'cannot remove last admin';
  end if;
  delete from memberships where tenant_id=p_tenant and user_id=p_user;
  perform log_audit(p_tenant,'membership.remove','membership',p_user::text,null,null);
end $$;

-- Criar tenant filho (empresa, unidade, canal) — única forma via cliente
create or replace function create_tenant(p_parent uuid, p_kind tenant_kind, p_name text, p_cnpj text default null, p_slug text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_parent_kind tenant_kind;
begin
  if not can_admin(p_parent) then raise exception 'forbidden'; end if;
  select kind into v_parent_kind from tenants where id=p_parent;
  -- regras de composição
  if p_kind='platform' then raise exception 'cannot create platform'; end if;
  if p_kind='unit' and v_parent_kind<>'company' then raise exception 'unit must be under company'; end if;
  if p_kind='company' and v_parent_kind not in ('platform','channel') then raise exception 'company must be under platform or channel'; end if;
  if p_kind='channel' and v_parent_kind not in ('platform','channel') then raise exception 'channel must be under platform or channel'; end if;
  insert into tenants (parent_id,kind,name,cnpj,slug,created_by) values (p_parent,p_kind,p_name,p_cnpj,p_slug,auth.uid()) returning id into v_id;
  -- quem cria uma company vira owner dela (se for usuário do canal, mantém acesso por herança)
  if p_kind='company' and role_in(p_parent) in ('owner') then
    insert into memberships (user_id,tenant_id,role,created_by) values (auth.uid(),v_id,'owner',auth.uid());
  end if;
  perform log_audit(v_id,'tenant.create','tenant',v_id::text,null,jsonb_build_object('kind',p_kind,'name',p_name,'cnpj',p_cnpj,'parent',p_parent));
  return v_id;
end $$;

-- Mover subárvore (só platform)
create or replace function move_tenant(p_tenant uuid, p_new_parent uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old ltree; v_new_parent ltree;
begin
  if not is_platform() then raise exception 'forbidden'; end if;
  select path into v_old from tenants where id=p_tenant;
  select path into v_new_parent from tenants where id=p_new_parent;
  if v_new_parent <@ v_old then raise exception 'cannot move under own descendant'; end if;
  alter table tenants disable trigger trg_tenants_reparent;
  update tenants set parent_id = p_new_parent where id = p_tenant;
  update tenants set path = v_new_parent || subpath(path, nlevel(v_old)-1), level = nlevel(v_new_parent || subpath(path, nlevel(v_old)-1)) - 1
   where path <@ v_old;
  alter table tenants enable trigger trg_tenants_reparent;
  perform log_audit(p_tenant,'tenant.move','tenant',p_tenant::text,jsonb_build_object('path',v_old::text),jsonb_build_object('parent',p_new_parent));
end $$;

grant execute on function invite_user(uuid,citext,member_role), accept_invitation(text), set_member_role(uuid,uuid,member_role), remove_member(uuid,uuid), create_tenant(uuid,tenant_kind,text,text,text), move_tenant(uuid,uuid) to authenticated;
```

**Aceite 1.5:** owner convida `finance` → e-mail → aceite cria membership; convite expirado falha; e-mail diferente falha; remover o último owner falha; `create_tenant(unit sob channel)` falha; `move_tenant` por não-platform falha.

---

## 1.6 Auditoria (migration 0005)

```sql
create or replace function log_audit(p_tenant uuid, p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_rule uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (tenant_id,actor_id,actor_role,impersonated_by,action,entity,entity_id,before,after,rule_version_id,ip,user_agent)
  values (p_tenant, auth.uid(), role_in(p_tenant)::text,
          nullif(current_setting('request.jwt.claims',true)::jsonb->>'impersonated_by','')::uuid,
          p_action,p_entity,p_entity_id,p_before,p_after,p_rule,
          nullif(current_setting('request.headers',true)::jsonb->>'x-forwarded-for','')::inet,
          current_setting('request.headers',true)::jsonb->>'user-agent');
end $$;
grant execute on function log_audit(uuid,text,text,text,jsonb,jsonb,uuid) to authenticated;

-- Trigger genérico para tabelas sensíveis (tenants, memberships, subscriptions, rule_versions, api_keys)
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  v_tenant := coalesce( (case when tg_table_name='tenants' then coalesce(new.id,old.id) else coalesce(new.tenant_id,old.tenant_id) end), null);
  perform log_audit(v_tenant, tg_table_name||'.'||lower(tg_op), tg_table_name, coalesce(new.id,old.id)::text, to_jsonb(old), to_jsonb(new));
  return coalesce(new,old);
end $$;
create trigger audit_tenants        after insert or update on tenants        for each row execute function audit_row();
create trigger audit_subscriptions  after insert or update or delete on subscriptions  for each row execute function audit_row();
create trigger audit_rule_versions  after insert or update on rule_versions  for each row execute function audit_row();
create trigger audit_api_keys       after insert or update on api_keys       for each row execute function audit_row();
```

**Aceite 1.6:** toda RPC de 1.5 deixa linha em `audit_log`; `update audit_log` e `delete` como `authenticated` falham; um `channel_admin` lê auditoria das empresas abaixo mas não do canal vizinho.

---

## 1.7 Seed e gestão no Lovable

### Seed (migration 0006 — só em dev/staging)
Platform "FLUXA" → Channel "Contábil Alfa" (slug `alfa`) → Company "Distribuidora Beta" (CNPJ fictício válido, ex. 11.222.333/0001-81) → Unit "Beta — Filial 02"; Company "Serviços Gama" (CNPJ fictício) direto sob platform; Plans: starter/pro/scale/channel; usuários: `admin@fluxa.dev` (platform_admin), `canal@alfa.dev` (channel_admin em Contábil Alfa), `dono@beta.dev` (owner em Distribuidora Beta), `fin@beta.dev` (finance em Distribuidora Beta), `viewer@gama.dev` (viewer em Serviços Gama). Uma `rule_version` `is_current`. Dados 100% fictícios; nenhum CNPJ real.

### Blocos para o Lovable (colar um por vez, com o cabeçalho de contexto)

**1.7.1 — Conexão e Auth.** "Conecte ao projeto Supabase existente (não crie tabelas). Implemente: /login (e-mail/senha + magic link + Google), /signup, /forgot, /reset, /confirm, /invite/:token (aceita via RPC `accept_invitation`), /mfa (enrolar TOTP; obrigatório se o usuário tiver algum papel platform_* ou channel_admin — verificar via `memberships`). Layout auth: cartão centralizado, superfície elevada, logo, sem ilustração. Após login: se `profiles.last_tenant` existir e estiver em `auth_scopes`, redirecionar para `/t/:tenantId`; senão `/select-tenant`."

**1.7.2 — Seletor de tenant e app shell.** "Tela /select-tenant lista tenants em que o usuário tem membership direto (`memberships` join `tenants`), agrupados por tipo, com busca. App shell em /t/:tenantId: sidebar colapsável (itens variam por `kind`: platform → Tenants, Planos, Regras, Operações, Crédito, Auditoria; channel → Carteira, Empresas, Usuários, Marca, Comissões; company/unit → Caixa, Carteira, Preço, Regime, Financiamento, Configurações), topbar com breadcrumb hierárquico (ancestrais do tenant ativo, clicáveis se estiverem no escopo), busca ⌘K, sino, avatar com menu (perfil, trocar tenant, sair). Aplicar `tenants.brand` (logo/cor) do canal ancestral mais próximo. Salvar `profiles.last_tenant` ao trocar."

**1.7.3 — Gestão de usuários (todos os níveis).** "Rota /t/:tenantId/settings/users: tabela de membros (`v_tenant_members`) com papel editável (RPC `set_member_role`), remover (RPC `remove_member`, confirmar), convidar (modal: e-mail + papel restrito ao tipo do tenant; chama RPC `invite_user`, depois Edge Function `send-invite` com o token). Aba Convites: pendentes com reenviar/revogar (update status). Botões visíveis só se `can_admin(tenantId)`."

**1.7.4 — Árvore de tenants (platform e channel).** "Rota /t/:tenantId/tenants: árvore expansível (children por `parent_id`, carregados sob demanda) com badge de tipo, status, cnpj, plano; ações: criar filho (RPC `create_tenant` com formulário por tipo: empresa pede CNPJ e consulta pública de razão social; canal pede slug e marca), editar nome/marca/status, ver membros, impersonar (só platform; chama Edge Function `impersonate`; banner fixo). Busca por nome/CNPJ. Para channel, a raiz é o próprio canal."

**1.7.5 — Planos e assinaturas (platform) + Perfil.** "Rota /t/:tenantId/plans (platform): CRUD de `plans`; em cada tenant, aba Assinatura com plano atual, status, trocar plano (só platform/channel_admin). Rota /profile: nome, avatar (Storage bucket `avatars`, público), telefone, MFA, sessões."

**1.7.6 — Auditoria.** "Rota /t/:tenantId/audit: tabela paginada de `audit_log` no escopo, filtros por ação/entidade/ator/data, expandir before/after como diff JSON. Somente leitura."

### Edge Functions desta fase (Lovable pode gerar; usar service role só nelas)
- `send-invite` — recebe `{invitation_id, token}`, valida via service role que o chamador é admin do tenant (`can_admin`), envia e-mail com link `/invite/:token`.
- `impersonate` — só `platform_admin`; gera sessão para o usuário alvo com claim `impersonated_by`, TTL 30 min, grava `audit_log`.

---

## 1.8 Matriz de testes de aceite (rodar com os 5 usuários do seed)

| Teste | admin@fluxa (platform) | canal@alfa (channel Alfa) | dono@beta (owner) | fin@beta (finance) | viewer@gama |
|---|---|---|---|---|---|
| `select * from tenants` | todos | Alfa + Beta + Beta Filial 02 | Beta + Filial 02 | Beta + Filial 02 | Serviços Gama |
| Ver membros de Beta | sim | sim | sim | sim | **não** |
| Convidar em Beta | sim | sim | sim | **não** | **não** |
| Criar unidade sob Beta | sim | sim | sim | **não** | **não** |
| Criar empresa sob Alfa | sim | sim | **não** | **não** | **não** |
| Criar canal sob platform | sim | **não** | **não** | **não** | **não** |
| Editar plano de Beta | sim | sim | **não** | **não** | **não** |
| Ler auditoria de Beta | sim | sim | sim | sim | **não** |
| Ler auditoria de Alfa | sim | sim | **não** | **não** | **não** |
| `update audit_log` | **não** | **não** | **não** | **não** | **não** |
| Impersonar | sim | **não** | **não** | **não** | **não** |
| Remover último owner de Beta | **falha** | **falha** | **falha** | — | — |
| Reparent via update | **falha** | **falha** | **falha** | — | — |

Cada célula é uma query ou clique. Só avança para o 02 quando a matriz está 100% verde.
