-- 0026b_alert_actions.sql
-- ESPELHO de funções que existiam no banco sem arquivo em db/migrations.
-- Sem elas o sino de alertas sobe, mas "marcar como lido" e "resolver" quebram
-- em runtime num ambiente novo. Extraído de pg_get_functiondef.

create or replace function public.ack_alert(p_alert uuid)
returns void
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from alerts where id=p_alert;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;
  update alerts set read_at=coalesce(read_at,now()) where id=p_alert;
end $function$;

create or replace function public.resolve_alert(p_alert uuid, p_note text default null::text)
returns void
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from alerts where id=p_alert;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;
  update alerts set resolved_at=now(), resolved_by=auth.uid(),
                    payload = payload || jsonb_build_object('resolution_note', p_note)
   where id=p_alert;
  perform log_audit(v_tenant,'alert.resolve','alert',p_alert::text,null,jsonb_build_object('note',p_note));
end $function$;

revoke all on function public.ack_alert(uuid) from public, anon;
revoke all on function public.resolve_alert(uuid, text) from public, anon;
grant execute on function public.ack_alert(uuid) to authenticated;
grant execute on function public.resolve_alert(uuid, text) to authenticated;
grant execute on function public.ack_alert(uuid) to service_role;
grant execute on function public.resolve_alert(uuid, text) to service_role;
