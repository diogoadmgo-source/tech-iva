-- 0222_security_scan_fixes.sql
-- 1) políticas das tabelas DFe estavam TO public (inclui anon): recria TO authenticated
drop policy if exists dfe_sync_state_read on public.dfe_sync_state;
create policy dfe_sync_state_read on public.dfe_sync_state
  for select to authenticated using (in_scope(tenant_id));

drop policy if exists dfe_pending_manifest_read on public.dfe_pending_manifest;
create policy dfe_pending_manifest_read on public.dfe_pending_manifest
  for select to authenticated using (in_scope(tenant_id));

drop policy if exists dfe_events_read on public.dfe_events;
create policy dfe_events_read on public.dfe_events
  for select to authenticated using (in_scope(tenant_id));

revoke all on public.dfe_sync_state from anon;
revoke all on public.dfe_pending_manifest from anon;
revoke all on public.dfe_events from anon;
grant select on public.dfe_sync_state to authenticated;
grant select on public.dfe_pending_manifest to authenticated;
grant select on public.dfe_events to authenticated;
grant all on public.dfe_sync_state to service_role;
grant all on public.dfe_pending_manifest to service_role;
grant all on public.dfe_events to service_role;

-- 2) receivables: escrita só por service role / RPC security definer.
revoke insert, update, delete, truncate on public.receivables from authenticated, anon;
drop policy if exists receivables_no_write on public.receivables;
create policy receivables_no_write on public.receivables
  for all to authenticated using (false) with check (false);
grant select on public.receivables to authenticated;
grant all on public.receivables to service_role;