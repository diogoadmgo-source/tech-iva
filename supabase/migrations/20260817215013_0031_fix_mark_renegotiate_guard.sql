-- Migration 20260817215013 (0031_fix_mark_renegotiate_guard) — exportada de supabase_migrations.schema_migrations
create or replace function mark_renegotiate(p_tenant uuid, p_parties uuid[], p_note text default null)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare v_count integer := 0; v_party record;
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance','commercial']::member_role[]) then
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
grant execute on function mark_renegotiate(uuid, uuid[], text) to authenticated;
