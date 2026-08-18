-- Migration 20260818001322 (0070b_fix_alert_severity_cast) — exportada de supabase_migrations.schema_migrations
create or replace function check_expiring_credentials()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0;
begin
  for r in
    select id, tenant_id, provider, subject_cn, not_after, (not_after - current_date) dias
    from integration_credentials
    where status='ativa' and not_after is not null
      and (not_after - current_date) in (30, 15, 7, 1)
  loop
    insert into alerts (tenant_id, kind, severity, title, payload)
    values (r.tenant_id, 'credential_expiring',
            (case when r.dias <= 7 then 'critical' else 'warning' end)::alert_severity,
            'Credencial de '||r.provider||' expira em '||r.dias||' dias',
            jsonb_build_object('credential_id', r.id, 'not_after', r.not_after));
    n := n + 1;
  end loop;

  update integration_credentials set status='expirada'
   where status='ativa' and not_after is not null and not_after < current_date;
  return n;
end $$;
revoke execute on function check_expiring_credentials() from public, anon, authenticated;
grant execute on function check_expiring_credentials() to service_role;
