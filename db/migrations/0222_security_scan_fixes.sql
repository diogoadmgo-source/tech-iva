-- 0222_security_scan_fixes.sql — ESPELHO da migration aplicada no banco.
--
-- 1) dfe_sync_state / dfe_pending_manifest / dfe_events: as políticas de leitura
--    estavam `to public`, o que inclui o papel anon. Nada vazava (in_scope()
--    devolve vazio sem auth.uid()), mas a superfície de consulta existia.
--    Recria as três políticas `to authenticated` e tira qualquer privilégio do anon.
-- 2) receivables: escrita nunca vem do front — só service role / RPC security
--    definer. Torna isso explícito revogando insert/update/delete de authenticated
--    e adicionando política fail-closed (using false / check false).

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

revoke insert, update, delete, truncate on public.receivables from authenticated, anon;
drop policy if exists receivables_no_write on public.receivables;
create policy receivables_no_write on public.receivables
  for all to authenticated using (false) with check (false);
grant select on public.receivables to authenticated;
grant all on public.receivables to service_role;
