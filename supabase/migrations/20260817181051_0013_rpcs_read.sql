-- Migration 20260817181051 (0013_rpcs_read) — exportada de supabase_migrations.schema_migrations
-- FASE 02 / Seção B — RPCs de leitura e de fila

-- Enfileirar job (o dispatcher acorda o serviço via webhook)
create or replace function enqueue_job(p_tenant uuid, p_kind text, p_params jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_role member_role;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  v_role := role_in(p_tenant);
  if v_role not in ('platform_admin','platform_ops','channel_admin','channel_analyst','owner','finance','commercial') then
    raise exception 'forbidden';
  end if;
  if p_kind not in ('ingest_dfe','classify_chain','compute_taxes','project_cash','price_scenario',
                    'regime_sim','reprocess_rules','bank_sync') then
    raise exception 'unknown job kind %', p_kind;
  end if;
  insert into jobs (tenant_id, kind, params, requested_by) values (p_tenant, p_kind, coalesce(p_params,'{}'), auth.uid())
  returning id into v_id;
  perform log_audit(p_tenant,'job.enqueue','job',v_id::text,null,jsonb_build_object('kind',p_kind,'params',p_params));
  return v_id;
end $$;

create or replace function cancel_job(p_job uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from jobs where id = p_job;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;
  update jobs set status='canceled', finished_at=now() where id=p_job and status in ('queued','running');
  perform log_audit(v_tenant,'job.cancel','job',p_job::text,null,null);
end $$;

-- Dashboard do Caixa do Imposto
create or replace function dashboard_cash(p_tenant uuid, p_horizon_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
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
      coalesce(avg(event_date - v_today) filter (where kind='credit_in'),0) credit_avg_days
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
      from ev group by 1
    ) w
  ),
  worst as (
    select date_trunc('week', event_date)::date week,
           sum(case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents else 0 end) net
    from ev group by 1 order by net asc limit 1
  )
  select jsonb_build_object(
    'hero', jsonb_build_object('gap_30_cents',g30,'gap_60_cents',g60,'gap_90_cents',g90),
    'kpis', jsonb_build_object('tax_out_month_cents',tax_month,'credit_in_month_cents',credit_month,
                               'credit_backlog_cents',credit_backlog,'credit_avg_days',round(credit_avg_days)),
    'timeline', coalesce(t,'[]'::jsonb),
    'next_gap', (select case when week is null then null else jsonb_build_object('week',week,'amount_cents',net) end from worst),
    'horizon_days', p_horizon_days,
    'generated_at', now()
  ) into v_res
  from gaps, kpi, tl;
  return v_res;
end $$;

-- Mapa da cadeia (carteira)
create or replace function chain_map(p_tenant uuid, p_role party_role default 'customer', p_filters jsonb default '{}')
returns table (id uuid, cnpj text, name text, regime regime_kind, credit_transfer_pct numeric,
               share_pct numeric, total_cents bigint, credit_lost_cents bigint, semaphore text, suggested_action text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_dir invoice_direction := case when p_role='supplier' then 'in' else 'out' end;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  with base as (
    select c.id, c.cnpj, c.name, c.regime, c.credit_transfer_pct,
           coalesce(sum(i.total_cents),0)::bigint total_cents,
           coalesce(sum(i.credit_cents),0)::bigint credit_cents
    from counterparties c
    left join invoices i on i.counterparty_id = c.id and i.tenant_id = c.tenant_id
                        and i.direction = v_dir and i.issued_at >= current_date - 365
    where c.tenant_id = p_tenant and (c.role = p_role or c.role = 'both')
    group by 1,2,3,4,5
  ), tot as (select nullif(sum(total_cents),0) s from base)
  select b.id, b.cnpj, b.name, b.regime, b.credit_transfer_pct,
         round(100.0 * b.total_cents / coalesce((select s from tot),1), 2) as share_pct,
         b.total_cents,
         (b.total_cents * (100 - coalesce(b.credit_transfer_pct,0)) / 100)::bigint as credit_lost_cents,
         case
           when b.regime = 'desconhecido' then 'warn'
           when p_role='customer' and b.regime in ('real','presumido')
                and round(100.0*b.total_cents/coalesce((select s from tot),1),2) > 10 then 'crit'
           when p_role='supplier' and b.regime in ('simples','mei','pf')
                and round(100.0*b.total_cents/coalesce((select s from tot),1),2) > 10 then 'crit'
           else 'ok' end as semaphore,
         case
           when b.regime = 'desconhecido' then 'Classificar'
           when p_role='customer' and b.regime in ('real','presumido') then 'Atenção: exige crédito integral'
           when p_role='supplier' and b.regime in ('simples','mei','pf') then 'Avaliar troca'
           else 'Manter' end as suggested_action
  from base b
  order by b.total_cents desc;
end $$;

-- Detalhe de contraparte
create or replace function counterparty_detail(p_tenant uuid, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
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
end $$;

-- Regime manual
create or replace function set_regime_manual(p_tenant uuid, p_party uuid, p_regime regime_kind, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_old regime_kind;
begin
  if role_in(p_tenant) not in ('platform_admin','channel_admin','owner','finance') then raise exception 'forbidden'; end if;
  select regime into v_old from counterparties where id=p_party and tenant_id=p_tenant;
  if v_old is null then raise exception 'not found'; end if;
  update counterparties set regime=p_regime, regime_source='manual', regime_checked_at=now()
   where id=p_party and tenant_id=p_tenant;
  perform log_audit(p_tenant,'counterparty.regime','counterparty',p_party::text,
                    jsonb_build_object('regime',v_old), jsonb_build_object('regime',p_regime,'reason',p_reason));
end $$;

-- Alertas
create or replace function ack_alert(p_alert uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from alerts where id=p_alert;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;
  update alerts set read_at=coalesce(read_at,now()) where id=p_alert;
end $$;

create or replace function resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from alerts where id=p_alert;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;
  update alerts set resolved_at=now(), resolved_by=auth.uid(),
                    payload = payload || jsonb_build_object('resolution_note', p_note)
   where id=p_alert;
  perform log_audit(v_tenant,'alert.resolve','alert',p_alert::text,null,jsonb_build_object('note',p_note));
end $$;

-- Carteira do canal
create or replace function channel_portfolio(p_tenant uuid, p_filters jsonb default '{}')
returns table (tenant_id uuid, name text, cnpj text, plan_code text, last_ingest timestamptz,
               gap_30_cents bigint, gap_90_cents bigint, open_alerts bigint, next_window date)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if role_in(p_tenant) not in ('platform_admin','platform_ops','channel_admin','channel_analyst') then
    raise exception 'forbidden';
  end if;
  return query
  select t.id, t.name, t.cnpj,
         (select p.code from subscriptions s join plans p on p.id=s.plan_id where s.tenant_id=t.id order by s.started_at desc limit 1),
         (select max(j.finished_at) from jobs j where j.tenant_id=t.id and j.kind='ingest_dfe' and j.status='done'),
         coalesce((select sum(case e.kind when 'tax_out' then -e.amount_cents when 'credit_in' then e.amount_cents else 0 end)
                     from tax_cash_events e where e.tenant_id=t.id
                      and e.event_date between current_date and current_date+30),0)::bigint,
         coalesce((select sum(case e.kind when 'tax_out' then -e.amount_cents when 'credit_in' then e.amount_cents else 0 end)
                     from tax_cash_events e where e.tenant_id=t.id
                      and e.event_date between current_date and current_date+90),0)::bigint,
         (select count(*) from alerts a where a.tenant_id=t.id and a.resolved_at is null),
         (select r.next_window from regime_simulations r where r.tenant_id=t.id order by r.run_at desc limit 1)
  from tenants t
  where t.kind='company' and t.status='active'
    and t.path <@ (select path from tenants where id=p_tenant)
  order by 6 asc;
end $$;

grant execute on function enqueue_job(uuid,text,jsonb), cancel_job(uuid), dashboard_cash(uuid,int),
  chain_map(uuid,party_role,jsonb), counterparty_detail(uuid,uuid), set_regime_manual(uuid,uuid,regime_kind,text),
  ack_alert(uuid), resolve_alert(uuid,text), channel_portfolio(uuid,jsonb) to authenticated;
revoke execute on all functions in schema public from anon;
