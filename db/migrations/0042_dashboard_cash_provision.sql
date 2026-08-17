-- 0042_dashboard_cash_provision.sql
-- Espelho de migration JÁ APLICADA no banco (não reaplicar cegamente).
-- dashboard_cash:
--   * devolve kpis.provision_month_cents e kpis.provision_horizon_cents;
--   * exclui eventos 'provision' da timeline, do next_gap e do cálculo de gap
--     (provisão é sugestão de reserva, não movimento de caixa).

create or replace function public.dashboard_cash(p_tenant uuid, p_horizon_days integer default 90)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare v_today date := current_date; v_res jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  with ev as (
    select * from tax_cash_events
     where tenant_id = p_tenant and event_date between v_today and v_today + p_horizon_days
  ),
  gaps as (
    select
      coalesce(sum(case when event_date <= v_today+30 then
        case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents
                  when 'loan_in' then amount_cents when 'loan_out' then -amount_cents else 0 end end),0) g30,
      coalesce(sum(case when event_date <= v_today+60 then
        case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents
                  when 'loan_in' then amount_cents when 'loan_out' then -amount_cents else 0 end end),0) g60,
      coalesce(sum(case when event_date <= v_today+90 then
        case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents
                  when 'loan_in' then amount_cents when 'loan_out' then -amount_cents else 0 end end),0) g90
    from ev
  ),
  kpi as (
    select
      coalesce(sum(amount_cents) filter (where kind='tax_out' and date_trunc('month',event_date)=date_trunc('month',v_today)),0) tax_month,
      coalesce(sum(amount_cents) filter (where kind='credit_in' and date_trunc('month',event_date)=date_trunc('month',v_today)),0) credit_month,
      coalesce(sum(amount_cents) filter (where kind='credit_in'),0) credit_backlog,
      coalesce(avg(event_date - v_today) filter (where kind='credit_in'),0) credit_avg_days,
      coalesce(sum(amount_cents) filter (where kind='provision' and date_trunc('month',event_date)=date_trunc('month',v_today)),0) prov_month,
      coalesce(sum(amount_cents) filter (where kind='provision'),0) prov_horizon
    from ev
  ),
  tl as (
    select jsonb_agg(jsonb_build_object(
             'week', week, 'tax_out_cents', tax_out_cents, 'credit_in_cents', credit_in_cents,
             'net_cents', net_cents, 'confidence', round(confidence,2)) order by week) t
    from (
      select date_trunc('week', event_date)::date week,
             sum(case when kind='tax_out' then amount_cents else 0 end) tax_out_cents,
             sum(case when kind='credit_in' then amount_cents else 0 end) credit_in_cents,
             sum(case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents
                           when 'loan_in' then amount_cents when 'loan_out' then -amount_cents else 0 end) net_cents,
             avg(confidence) confidence
      from ev where kind <> 'provision' group by 1
    ) w
  ),
  worst as (
    select date_trunc('week', event_date)::date week,
           sum(case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents else 0 end) net
    from ev where kind <> 'provision' group by 1 order by net asc limit 1
  )
  select jsonb_build_object(
    'hero', jsonb_build_object('gap_30_cents',g30,'gap_60_cents',g60,'gap_90_cents',g90),
    'kpis', jsonb_build_object('tax_out_month_cents',tax_month,'credit_in_month_cents',credit_month,
                               'credit_backlog_cents',credit_backlog,'credit_avg_days',round(credit_avg_days),
                               'provision_month_cents',prov_month,'provision_horizon_cents',prov_horizon),
    'timeline', coalesce(t,'[]'::jsonb),
    'next_gap', (select case when week is null then null else jsonb_build_object('week',week,'amount_cents',net) end from worst),
    'horizon_days', p_horizon_days,
    'generated_at', now()
  ) into v_res
  from gaps, kpi, tl;
  return v_res;
end $function$;
