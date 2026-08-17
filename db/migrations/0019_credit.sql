-- 0019_credit.sql — Documento 02 C6 / Documento 03 bloco 3.8 (T5 Financiamento)
-- Schema isolado credit.* (sem grants ao cliente; acesso exclusivo por RPCs em public).
-- Cria:
--   credit.policies / offers / contracts / ledger / repayments
--   can_credit(p_tenant)                                -> boolean (owner/finance/platform)
--   credit_generate_offers(p_tenant)                    -> int      (recalcula ofertas pendentes)
--   credit_offers(p_tenant)                             -> setof jsonb
--   credit_offer_detail(p_offer)                         -> jsonb   (breakdown + parcelas + impacto no T1)
--   accept_credit_offer(p_offer, p_signature_ref)        -> uuid    (exige aal2; gera contrato/ledger/loan_*)
--   credit_contracts(p_tenant)                          -> setof jsonb
--   credit_contract_detail(p_contract)                    -> jsonb   (timeline de repagamento + ledger)

create schema if not exists credit;
revoke all on schema credit from public;
revoke usage on schema credit from anon, authenticated;
grant usage on schema credit to service_role;

create table if not exists credit.policies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null,                       -- credit_advance | gap_line | provision_account
  label text not null,
  discount_pct numeric(6,3) not null default 0,   -- deságio (antecipação)
  monthly_rate_pct numeric(6,3) not null default 0,
  max_amount_cents bigint not null default 100000000,
  max_term_months int not null default 12,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists credit.risk_scores (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  score int not null default 600,
  limit_cents bigint not null default 0,
  computed_at timestamptz not null default now()
);

create table if not exists credit.offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_id uuid not null references credit.policies(id),
  kind text not null,
  amount_cents bigint not null,
  net_amount_cents bigint not null,
  term_months int not null default 1,
  monthly_rate_pct numeric(6,3) not null default 0,
  total_cost_cents bigint not null default 0,
  cet_pct numeric(6,2) not null default 0,
  reference_date date,
  status text not null default 'pending',   -- pending | accepted | expired
  memory jsonb not null default '{}',
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create index if not exists credit_offers_tenant on credit.offers (tenant_id, status);

create table if not exists credit.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  offer_id uuid not null references credit.offers(id),
  kind text not null,
  principal_cents bigint not null,
  net_disbursed_cents bigint not null,
  total_due_cents bigint not null,
  term_months int not null,
  monthly_rate_pct numeric(6,3) not null,
  cet_pct numeric(6,2) not null,
  status text not null default 'active',    -- active | settled | canceled
  signature_ref text not null,
  signed_by uuid,
  signed_at timestamptz not null default now()
);
create index if not exists credit_contracts_tenant on credit.contracts (tenant_id, status);

-- ledger append-only
create table if not exists credit.ledger (
  id bigserial primary key,
  contract_id uuid not null references credit.contracts(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_date date not null default current_date,
  kind text not null,                       -- disbursement | fee | interest | repayment
  amount_cents bigint not null,
  memo text,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_contract on credit.ledger (contract_id, entry_date);

create table if not exists credit.repayments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references credit.contracts(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  installment int not null,
  due_date date not null,
  amount_cents bigint not null,
  paid_at timestamptz,
  unique (contract_id, installment)
);

alter table credit.policies enable row level security;
alter table credit.risk_scores enable row level security;
alter table credit.offers enable row level security;
alter table credit.contracts enable row level security;
alter table credit.ledger enable row level security;
alter table credit.repayments enable row level security;

grant all on all tables in schema credit to service_role;
grant usage, select on all sequences in schema credit to service_role;

-- políticas de crédito (nível 0)
insert into credit.policies (code, kind, label, discount_pct, monthly_rate_pct, max_amount_cents, max_term_months)
values
  ('adv_credit_v1', 'credit_advance',    'Antecipação de crédito acumulado', 2.400, 0.000, 50000000, 6),
  ('gap_line_v1',   'gap_line',          'Linha para descasamento de caixa', 0.000, 1.890, 30000000, 12),
  ('prov_acc_v1',   'provision_account', 'Conta de provisão remunerada',     0.000, 0.850, 100000000, 12)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- permissão

create or replace function public.can_credit(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform()
      or (public.in_scope(p_tenant) and public.role_in(p_tenant) in ('owner','finance','channel_admin'))
$$;

-- ---------------------------------------------------------------- geração de ofertas

create or replace function public.credit_generate_offers(p_tenant uuid)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cash jsonb; v_gap bigint; v_gap_week date; v_backlog bigint; v_avg_days int;
  v_pol record; v_count int := 0;
  v_amount bigint; v_net bigint; v_total bigint; v_term int;
begin
  if not can_credit(p_tenant) then raise exception 'forbidden'; end if;

  v_cash := dashboard_cash(p_tenant, 90);
  v_backlog := coalesce((v_cash->'kpis'->>'credit_backlog_cents')::bigint, 0);
  v_avg_days := coalesce((v_cash->'kpis'->>'credit_avg_days')::int, 120);
  v_gap := abs(least(coalesce((v_cash->'next_gap'->>'amount_cents')::bigint, 0), 0));
  v_gap_week := nullif(v_cash->'next_gap'->>'week','')::date;

  -- expira ofertas antigas e limpa pendentes para recálculo
  update credit.offers set status = 'expired'
   where tenant_id = p_tenant and status = 'pending' and expires_at < now();
  delete from credit.offers where tenant_id = p_tenant and status = 'pending';

  for v_pol in select * from credit.policies where active order by code loop
    v_amount := null; v_term := 1; v_net := 0; v_total := 0;

    if v_pol.kind = 'credit_advance' and v_backlog > 0 then
      v_amount := least(v_backlog, v_pol.max_amount_cents);
      v_net := round(v_amount * (1 - v_pol.discount_pct / 100));
      v_total := v_amount - v_net;
      v_term := greatest(1, least(v_pol.max_term_months, ceil(coalesce(v_avg_days,120) / 30.0)::int));
    elsif v_pol.kind = 'gap_line' and v_gap > 0 then
      v_amount := least(v_gap, v_pol.max_amount_cents);
      v_term := least(6, v_pol.max_term_months);
      v_net := v_amount;
      v_total := round(v_amount * (power(1 + v_pol.monthly_rate_pct / 100, v_term) - 1));
    elsif v_pol.kind = 'provision_account' and v_backlog > 0 then
      v_amount := round(v_backlog * 0.30);
      v_term := least(6, v_pol.max_term_months);
      v_net := v_amount;
      v_total := round(v_amount * (power(1 + v_pol.monthly_rate_pct / 100, v_term) - 1));
    end if;

    if v_amount is null or v_amount <= 0 then continue; end if;

    insert into credit.offers (
      tenant_id, policy_id, kind, amount_cents, net_amount_cents, term_months,
      monthly_rate_pct, total_cost_cents, cet_pct, reference_date, memory)
    values (
      p_tenant, v_pol.id, v_pol.kind, v_amount, v_net, v_term,
      v_pol.monthly_rate_pct, v_total,
      case when v_amount > 0 then round((v_total::numeric / v_amount) * 100, 2) else 0 end,
      case when v_pol.kind = 'gap_line' then v_gap_week else current_date end,
      jsonb_build_object(
        'policy', v_pol.code, 'label', v_pol.label,
        'discount_pct', v_pol.discount_pct,
        'credit_backlog_cents', v_backlog,
        'credit_avg_days', v_avg_days,
        'gap_cents', v_gap, 'gap_week', v_gap_week));
    v_count := v_count + 1;
  end loop;

  perform log_audit(p_tenant, 'credit.offers.generate', 'credit_offer', null, null,
                    jsonb_build_object('count', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------- leitura

create or replace function public.credit_offers(p_tenant uuid)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not can_credit(p_tenant) then raise exception 'forbidden'; end if;
  return query
    select jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'label', p.label,
      'amount_cents', o.amount_cents, 'net_amount_cents', o.net_amount_cents,
      'term_months', o.term_months, 'monthly_rate_pct', o.monthly_rate_pct,
      'total_cost_cents', o.total_cost_cents, 'cet_pct', o.cet_pct,
      'discount_pct', p.discount_pct,
      'reference_date', o.reference_date, 'status', o.status,
      'expires_at', o.expires_at, 'memory', o.memory)
    from credit.offers o
    join credit.policies p on p.id = o.policy_id
    where o.tenant_id = p_tenant and o.status = 'pending'
    order by o.kind;
end $$;

create or replace function public.credit_offer_detail(p_offer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o record; v_installment bigint; v_schedule jsonb; v_cash jsonb;
begin
  select * into o from credit.offers where id = p_offer;
  if o.id is null then raise exception 'offer not found'; end if;
  if not can_credit(o.tenant_id) then raise exception 'forbidden'; end if;

  v_installment := ceil((o.net_amount_cents + o.total_cost_cents)::numeric / greatest(o.term_months,1));
  select jsonb_agg(jsonb_build_object(
           'installment', i,
           'due_date', (current_date + (i || ' month')::interval)::date,
           'amount_cents', v_installment) order by i)
    into v_schedule
    from generate_series(1, greatest(o.term_months,1)) i;

  v_cash := dashboard_cash(o.tenant_id, 90);

  return jsonb_build_object(
    'offer', (select jsonb_build_object(
                'id', o.id, 'kind', o.kind, 'amount_cents', o.amount_cents,
                'net_amount_cents', o.net_amount_cents, 'term_months', o.term_months,
                'monthly_rate_pct', o.monthly_rate_pct, 'total_cost_cents', o.total_cost_cents,
                'cet_pct', o.cet_pct, 'reference_date', o.reference_date, 'memory', o.memory)),
    'schedule', coalesce(v_schedule, '[]'::jsonb),
    'impact', jsonb_build_object(
      'gap_30_before_cents', (v_cash->'hero'->>'gap_30_cents')::bigint,
      'gap_30_after_cents', (v_cash->'hero'->>'gap_30_cents')::bigint + o.net_amount_cents,
      'gap_90_before_cents', (v_cash->'hero'->>'gap_90_cents')::bigint,
      'gap_90_after_cents', (v_cash->'hero'->>'gap_90_cents')::bigint + o.net_amount_cents
                              - least(o.term_months, 3) * v_installment));
end $$;

create or replace function public.credit_contracts(p_tenant uuid)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not can_credit(p_tenant) then raise exception 'forbidden'; end if;
  return query
    select jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'status', c.status,
      'principal_cents', c.principal_cents, 'net_disbursed_cents', c.net_disbursed_cents,
      'total_due_cents', c.total_due_cents, 'term_months', c.term_months,
      'monthly_rate_pct', c.monthly_rate_pct, 'cet_pct', c.cet_pct,
      'signed_at', c.signed_at, 'signature_ref', c.signature_ref,
      'paid_cents', (select coalesce(sum(r.amount_cents),0) from credit.repayments r
                      where r.contract_id = c.id and r.paid_at is not null),
      'next_due', (select min(r.due_date) from credit.repayments r
                    where r.contract_id = c.id and r.paid_at is null))
    from credit.contracts c
    where c.tenant_id = p_tenant
    order by c.signed_at desc;
end $$;

create or replace function public.credit_contract_detail(p_contract uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from credit.contracts where id = p_contract;
  if c.id is null then raise exception 'contract not found'; end if;
  if not can_credit(c.tenant_id) then raise exception 'forbidden'; end if;

  return jsonb_build_object(
    'contract', jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'status', c.status,
      'principal_cents', c.principal_cents, 'net_disbursed_cents', c.net_disbursed_cents,
      'total_due_cents', c.total_due_cents, 'term_months', c.term_months,
      'monthly_rate_pct', c.monthly_rate_pct, 'cet_pct', c.cet_pct,
      'signature_ref', c.signature_ref, 'signed_at', c.signed_at),
    'repayments', (select coalesce(jsonb_agg(jsonb_build_object(
        'installment', r.installment, 'due_date', r.due_date,
        'amount_cents', r.amount_cents, 'paid_at', r.paid_at) order by r.installment), '[]'::jsonb)
      from credit.repayments r where r.contract_id = c.id),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'entry_date', l.entry_date, 'kind', l.kind,
        'amount_cents', l.amount_cents, 'memo', l.memo) order by l.id), '[]'::jsonb)
      from credit.ledger l where l.contract_id = c.id));
end $$;

-- ---------------------------------------------------------------- contratação (exige aal2)

create or replace function public.accept_credit_offer(p_offer uuid, p_signature_ref text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  o record; v_contract uuid; v_total bigint; v_installment bigint; i int; v_due date;
begin
  select * into o from credit.offers where id = p_offer for update;
  if o.id is null then raise exception 'offer not found'; end if;
  if not can_credit(o.tenant_id) then raise exception 'forbidden'; end if;
  if coalesce(current_aal(), 'aal1') <> 'aal2' then raise exception 'MFA required'; end if;
  if o.status <> 'pending' then raise exception 'offer no longer available'; end if;
  if o.expires_at < now() then raise exception 'offer expired'; end if;
  if coalesce(nullif(trim(p_signature_ref), ''), '') = '' then raise exception 'signature required'; end if;

  v_total := o.net_amount_cents + o.total_cost_cents;
  v_installment := ceil(v_total::numeric / greatest(o.term_months, 1));

  insert into credit.contracts (
    tenant_id, offer_id, kind, principal_cents, net_disbursed_cents, total_due_cents,
    term_months, monthly_rate_pct, cet_pct, signature_ref, signed_by)
  values (
    o.tenant_id, o.id, o.kind, o.amount_cents, o.net_amount_cents, v_total,
    greatest(o.term_months, 1), o.monthly_rate_pct, o.cet_pct, trim(p_signature_ref), auth.uid())
  returning id into v_contract;

  update credit.offers set status = 'accepted' where id = o.id;

  insert into credit.ledger (contract_id, tenant_id, entry_date, kind, amount_cents, memo)
  values (v_contract, o.tenant_id, current_date, 'disbursement', o.net_amount_cents, 'Liberação do recurso');
  if o.total_cost_cents > 0 then
    insert into credit.ledger (contract_id, tenant_id, entry_date, kind, amount_cents, memo)
    values (v_contract, o.tenant_id, current_date,
            case when o.kind = 'credit_advance' then 'fee' else 'interest' end,
            o.total_cost_cents,
            case when o.kind = 'credit_advance' then 'Deságio da antecipação' else 'Custo financeiro do período' end);
  end if;

  -- entrada de caixa hoje
  perform ensure_tce_partition(current_date);
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_contract_id, confidence)
  values (o.tenant_id, current_date, 'loan_in', o.net_amount_cents, v_contract, 1.00);

  -- parcelas e saídas de caixa futuras
  for i in 1 .. greatest(o.term_months, 1) loop
    v_due := (current_date + (i || ' month')::interval)::date;
    insert into credit.repayments (contract_id, tenant_id, installment, due_date, amount_cents)
    values (v_contract, o.tenant_id, i, v_due, v_installment);
    perform ensure_tce_partition(v_due);
    insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_contract_id, confidence)
    values (o.tenant_id, v_due, 'loan_out', v_installment, v_contract, 1.00);
  end loop;

  perform log_audit(o.tenant_id, 'credit.accept', 'credit_contract', v_contract::text, null,
                    jsonb_build_object('offer_id', o.id, 'kind', o.kind,
                                       'net_amount_cents', o.net_amount_cents,
                                       'total_due_cents', v_total,
                                       'term_months', greatest(o.term_months,1),
                                       'cet_pct', o.cet_pct,
                                       'signature_ref', trim(p_signature_ref)));
  return v_contract;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.can_credit(uuid) from public, anon;
revoke execute on function public.credit_generate_offers(uuid) from public, anon;
revoke execute on function public.credit_offers(uuid) from public, anon;
revoke execute on function public.credit_offer_detail(uuid) from public, anon;
revoke execute on function public.credit_contracts(uuid) from public, anon;
revoke execute on function public.credit_contract_detail(uuid) from public, anon;
revoke execute on function public.accept_credit_offer(uuid, text) from public, anon;

grant execute on function public.can_credit(uuid) to authenticated;
grant execute on function public.credit_generate_offers(uuid) to authenticated;
grant execute on function public.credit_offers(uuid) to authenticated;
grant execute on function public.credit_offer_detail(uuid) to authenticated;
grant execute on function public.credit_contracts(uuid) to authenticated;
grant execute on function public.credit_contract_detail(uuid) to authenticated;
grant execute on function public.accept_credit_offer(uuid, text) to authenticated;
