-- ============================================================ 3.10 alertas e relatórios
-- Preferências de alerta ficam em tenants.settings->'alerts' (sem nova tabela).

create or replace function public.alert_prefs_default()
returns jsonb language sql immutable set search_path = public, extensions as $$
  select jsonb_build_object(
    'email_kinds', jsonb_build_array('gap_over_limit','ingest_failed','option_window'),
    'gap_critical_cents', 500000,
    'digest_enabled', true,
    'digest_weekday', 1)
$$;

create or replace function public.get_alert_prefs(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select alert_prefs_default() || coalesce(t.settings->'alerts', '{}'::jsonb)
    into v from tenants t where t.id = p_tenant;
  return v;
end $$;

create or replace function public.set_alert_prefs(p_tenant uuid, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_before jsonb; v_after jsonb;
begin
  if not can_admin(p_tenant) then raise exception 'forbidden'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'invalid prefs'; end if;

  select coalesce(t.settings->'alerts', '{}'::jsonb) into v_before from tenants t where t.id = p_tenant;
  v_after := alert_prefs_default() || v_before || p_prefs;

  update tenants
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('alerts', v_after),
         updated_at = now()
   where id = p_tenant;

  perform log_audit(p_tenant, 'alerts.prefs', 'tenant', p_tenant::text,
                    jsonb_build_object('alerts', v_before), jsonb_build_object('alerts', v_after));
  return v_after;
end $$;

-- Resumo semanal: executado pelo cron via service role (nunca pelo browser).
create or replace function public.weekly_digest_batch(p_weekday int default null)
returns setof jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_today date := current_date;
begin
  return query
  with t as (
    select tn.id, tn.name,
           alert_prefs_default() || coalesce(tn.settings->'alerts', '{}'::jsonb) as prefs
    from tenants tn
    where tn.kind = 'company' and tn.status = 'active'
  ), elig as (
    select * from t
    where (t.prefs->>'digest_enabled')::boolean is true
      and (p_weekday is null or (t.prefs->>'digest_weekday')::int = p_weekday)
  )
  select jsonb_build_object(
    'tenant_id', e.id,
    'tenant_name', e.name,
    'prefs', e.prefs,
    'recipients', coalesce((
      select jsonb_agg(distinct p.email)
      from memberships m join profiles p on p.user_id = m.user_id
      where m.tenant_id = e.id and m.role in ('owner','finance') and p.email is not null), '[]'::jsonb),
    'kpis', (
      select jsonb_build_object(
        'gap_30_cents', coalesce(sum(case when ev.event_date <= v_today + 30 then
            case ev.kind when 'tax_out' then -ev.amount_cents when 'credit_in' then ev.amount_cents
                         when 'loan_in' then ev.amount_cents when 'loan_out' then -ev.amount_cents else 0 end
          end), 0),
        'gap_90_cents', coalesce(sum(
            case ev.kind when 'tax_out' then -ev.amount_cents when 'credit_in' then ev.amount_cents
                         when 'loan_in' then ev.amount_cents when 'loan_out' then -ev.amount_cents else 0 end
          ), 0),
        'tax_out_month_cents', coalesce(sum(ev.amount_cents) filter (
            where ev.kind = 'tax_out'
              and date_trunc('month', ev.event_date) = date_trunc('month', v_today)), 0))
      from tax_cash_events ev
      where ev.tenant_id = e.id and ev.event_date between v_today and v_today + 90),
    'open_alerts', (select count(*) from alerts a where a.tenant_id = e.id and a.resolved_at is null),
    'top_alerts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'severity', a.severity,
                                          'title', a.title, 'created_at', a.created_at))
      from (select * from alerts a2
             where a2.tenant_id = e.id and a2.resolved_at is null
             order by case a2.severity when 'critical' then 0 when 'warning' then 1 else 2 end,
                      a2.created_at desc
             limit 3) a), '[]'::jsonb),
    'generated_at', now())
  from elig e;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.alert_prefs_default() from public, anon;
revoke execute on function public.get_alert_prefs(uuid) from public, anon;
revoke execute on function public.set_alert_prefs(uuid, jsonb) from public, anon;
revoke execute on function public.weekly_digest_batch(int) from public, anon, authenticated;

grant execute on function public.alert_prefs_default() to authenticated;
grant execute on function public.get_alert_prefs(uuid) to authenticated;
grant execute on function public.set_alert_prefs(uuid, jsonb) to authenticated;
grant execute on function public.weekly_digest_batch(int) to service_role;