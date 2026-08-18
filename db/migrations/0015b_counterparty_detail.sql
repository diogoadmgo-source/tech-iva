-- 0015b_counterparty_detail.sql
-- ESPELHO de função que existia no banco sem arquivo em db/migrations.
-- Alimenta a gaveta de detalhe da contraparte na tela /chain (12 meses de notas
-- + alertas abertos daquela contraparte). Extraído de pg_get_functiondef.

create or replace function public.counterparty_detail(p_tenant uuid, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare v jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'party', to_jsonb(c) - 'meta',
    'invoices_12m', (select coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'issued_at',i.issued_at,'direction',i.direction,'total_cents',i.total_cents,
        'ibs_cents',i.ibs_cents,'cbs_cents',i.cbs_cents,'credit_cents',i.credit_cents,'access_key',i.access_key)
        order by i.issued_at desc),'[]'::jsonb)
      from invoices i where i.tenant_id=p_tenant and i.counterparty_id=c.id and i.issued_at >= current_date-365),
    'open_alerts', (select count(*) from alerts a where a.tenant_id=p_tenant and a.resolved_at is null
                      and a.payload->>'counterparty_id' = c.id::text)
  ) into v from counterparties c where c.id=p_id and c.tenant_id=p_tenant;
  if v is null then raise exception 'not found'; end if;
  return v;
end $function$;

revoke all on function public.counterparty_detail(uuid, uuid) from public, anon;
grant execute on function public.counterparty_detail(uuid, uuid) to authenticated;
grant execute on function public.counterparty_detail(uuid, uuid) to service_role;
