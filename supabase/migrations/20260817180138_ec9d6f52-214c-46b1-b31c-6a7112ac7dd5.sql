alter function public.ltree_label(uuid) set search_path = public, extensions;
alter function public.tenants_set_path() set search_path = public, extensions;
alter function public.tenants_block_reparent() set search_path = public, extensions;
alter function public.role_requires_mfa(member_role) set search_path = public, extensions;
alter function public.current_aal() set search_path = public, extensions;

revoke all on function public.auth_scopes() from anon, public;
revoke all on function public.in_scope(uuid) from anon, public;
revoke all on function public.role_in(uuid) from anon, public;
revoke all on function public.is_platform() from anon, public;
revoke all on function public.can_admin(uuid) from anon, public;
revoke all on function public.enforce_mfa(uuid) from anon, public;
revoke all on function public.role_requires_mfa(member_role) from anon, public;
revoke all on function public.current_aal() from anon, public;
revoke all on function public.tenant_members(uuid) from anon, public;
revoke all on function public.log_audit(uuid,text,text,text,jsonb,jsonb,uuid) from anon, public;
revoke all on function public.audit_row() from anon, public;
revoke all on function public.handle_new_user() from anon, public;
revoke all on function public.invite_user(uuid,citext,member_role) from anon, public;
revoke all on function public.accept_invitation(text) from anon, public;
revoke all on function public.set_member_role(uuid,uuid,member_role) from anon, public;
revoke all on function public.remove_member(uuid,uuid) from anon, public;
revoke all on function public.create_tenant(uuid,tenant_kind,text,text,text) from anon, public;
revoke all on function public.move_tenant(uuid,uuid) from anon, public;

grant execute on function public.auth_scopes(), public.in_scope(uuid), public.role_in(uuid),
  public.is_platform(), public.can_admin(uuid), public.enforce_mfa(uuid),
  public.role_requires_mfa(member_role), public.current_aal(), public.tenant_members(uuid),
  public.log_audit(uuid,text,text,text,jsonb,jsonb,uuid),
  public.invite_user(uuid,citext,member_role), public.accept_invitation(text),
  public.set_member_role(uuid,uuid,member_role), public.remove_member(uuid,uuid),
  public.create_tenant(uuid,tenant_kind,text,text,text), public.move_tenant(uuid,uuid)
  to authenticated;