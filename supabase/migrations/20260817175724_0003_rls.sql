-- Migration 20260817175724 (0003_rls) — exportada de supabase_migrations.schema_migrations
alter table tenants        enable row level security;
alter table profiles       enable row level security;
alter table memberships    enable row level security;
alter table invitations    enable row level security;
alter table plans          enable row level security;
alter table subscriptions  enable row level security;
alter table rule_versions  enable row level security;
alter table api_keys       enable row level security;
alter table audit_log      enable row level security;

create policy tenants_select on tenants for select to authenticated using (in_scope(id));
create policy tenants_insert on tenants for insert to authenticated with check (parent_id is not null and can_admin(parent_id));
create policy tenants_update on tenants for update to authenticated using (can_admin(id)) with check (can_admin(id));

create policy profiles_self_select on profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_self_update on profiles for update to authenticated using (user_id = auth.uid());
create policy profiles_self_insert on profiles for insert to authenticated with check (user_id = auth.uid());

create policy memberships_select on memberships for select to authenticated using (user_id = auth.uid() or in_scope(tenant_id));
create policy memberships_write  on memberships for all    to authenticated using (can_admin(tenant_id)) with check (can_admin(tenant_id));

create policy invitations_select on invitations for select to authenticated using (in_scope(tenant_id));
create policy invitations_write  on invitations for all    to authenticated using (can_admin(tenant_id)) with check (can_admin(tenant_id));

create policy plans_select on plans for select to authenticated using (active or is_platform());
create policy plans_write  on plans for all to authenticated using (is_platform()) with check (is_platform());

create policy subs_select on subscriptions for select to authenticated using (in_scope(tenant_id));
create policy subs_write  on subscriptions for all to authenticated using (is_platform() or role_in(tenant_id)='channel_admin') with check (is_platform() or role_in(tenant_id)='channel_admin');

create policy rules_select on rule_versions for select to authenticated using (true);
create policy rules_write  on rule_versions for all to authenticated using (is_platform()) with check (is_platform());

create policy apikeys_all on api_keys for all to authenticated using (can_admin(tenant_id)) with check (can_admin(tenant_id));

create policy audit_select on audit_log for select to authenticated using (tenant_id is null and is_platform() or in_scope(tenant_id));
