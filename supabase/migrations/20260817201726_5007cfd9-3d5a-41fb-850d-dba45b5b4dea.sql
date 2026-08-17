create or replace function public.mark_renegotiate(p_tenant uuid, p_parties uuid[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare v_count integer := 0; v_party record;
begin
  if role_in(p_tenant) not in ('platform_admin','channel_admin','owner','finance','commercial') then
    raise exception 'forbidden';
  end if;
  for v_party in
    select id, cnpj, name from counterparties
     where tenant_id = p_tenant and id = any(p_parties)
  loop
    insert into alerts (tenant_id, kind, severity, title, payload)
    values (p_tenant, 'counterparty.renegotiate', 'info',
            'Marcado para renegociar: ' || coalesce(v_party.name, v_party.cnpj),
            jsonb_build_object('counterparty_id', v_party.id, 'cnpj', v_party.cnpj, 'note', p_note));
    v_count := v_count + 1;
  end loop;
  perform log_audit(p_tenant, 'counterparty.renegotiate', 'counterparty', null,
                    null, jsonb_build_object('parties', to_jsonb(p_parties), 'note', p_note, 'count', v_count));
  return v_count;
end $$;

revoke all on function public.mark_renegotiate(uuid, uuid[], text) from public, anon;
grant execute on function public.mark_renegotiate(uuid, uuid[], text) to authenticated;