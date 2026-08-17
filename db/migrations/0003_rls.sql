-- 0003_rls.sql
-- Bloco 1.3 do documento 01 — RLS do plano de controle.
-- Regra de ouro: nenhuma política de escrita usa `true`; nenhum delete liberado em tenants.

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

-- profiles: o próprio (nome/avatar de terceiros só via tenant_members())
create policy profiles_self_select on profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_self_update on profiles for update to authenticated using (user_id = auth.uid());
create policy profiles_self_insert on profiles for insert to authenticated with check (user_id = auth.uid());

-- memberships: ver as do escopo; criar/alterar/remover só admin do tenant
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

-- audit_log: leitura no escopo; escrita só por função (security definer); sem update/delete
create policy audit_select on audit_log for select to authenticated using (tenant_id is null and is_platform() or in_scope(tenant_id));

-- View de membros conforme documento. ATENÇÃO: substituída em 0003b pela função
-- tenant_members(p_tenant) — decisão gravada (a view com security_invoker não consegue
-- ler auth.users nem profiles de terceiros sob RLS).
create or replace view v_tenant_members with (security_invoker = true) as
select m.tenant_id, m.user_id, m.role, m.created_at, p.full_name, p.avatar_url, u.email
from memberships m join profiles p on p.user_id = m.user_id join auth.users u on u.id = m.user_id;
grant select on v_tenant_members to authenticated;
