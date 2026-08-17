grant execute on function public.auth_scopes() to authenticated;
grant execute on function public.in_scope(uuid) to authenticated;
grant execute on function public.role_in(uuid) to authenticated;
grant execute on function public.can_admin(uuid) to authenticated;
grant execute on function public.is_platform() to authenticated;
grant execute on function public.job_kind_allowed(uuid,text) to authenticated;

revoke execute on function public.auth_scopes() from public, anon;
revoke execute on function public.in_scope(uuid) from public, anon;
revoke execute on function public.role_in(uuid) from public, anon;
revoke execute on function public.can_admin(uuid) from public, anon;
revoke execute on function public.is_platform() from public, anon;
revoke execute on function public.job_kind_allowed(uuid,text) from public, anon;