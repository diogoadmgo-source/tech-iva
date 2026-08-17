-- 0010_data_plane.sql — Documento 02, bloco A
do $$ begin create type invoice_direction as enum ('out','in'); exception when duplicate_object then null; end $$;
do $$ begin create type party_role as enum ('customer','supplier','both'); exception when duplicate_object then null; end $$;
do $$ begin create type regime_kind as enum ('simples','simples_hibrido','presumido','real','mei','pf','imune','desconhecido'); exception when duplicate_object then null; end $$;
do $$ begin create type cash_event_kind as enum ('tax_out','credit_in','provision','credit_advance','loan_in','loan_out'); exception when duplicate_object then null; end $$;
do $$ begin create type job_status as enum ('queued','running','done','failed','canceled'); exception when duplicate_object then null; end $$;
do $$ begin create type alert_severity as enum ('info','warning','critical'); exception when duplicate_object then null; end $$;

create table if not exists counterparties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cnpj text not null, name text, role party_role not null default 'both',
  regime regime_kind not null default 'desconhecido', regime_source text, regime_checked_at timestamptz,
  credit_transfer_pct numeric(5,2),
  revenue_share_pct numeric(5,2), purchase_share_pct numeric(5,2),
  risk_flag text, meta jsonb not null default '{}', created_at timestamptz not null default now(),
  unique (tenant_id, cnpj)
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  direction invoice_direction not null, model text not null, access_key text not null unique,
  number text, series text, issued_at date not null,
  counterparty_id uuid references counterparties(id) on delete set null,
  total_cents bigint not null, ibs_cents bigint default 0, cbs_cents bigint default 0, is_cents bigint default 0,
  credit_cents bigint default 0, raw_xml_path text, status text not null default 'authorized',
  rule_version_id uuid references rule_versions(id), inconsistencies jsonb not null default '[]',
  ingested_at timestamptz not null default now()
);
create index if not exists invoices_tenant_date on invoices (tenant_id, issued_at desc);
create index if not exists invoices_tenant_party on invoices (tenant_id, counterparty_id);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade, line int not null,
  product_id uuid, ncm text, cst text, cclasstrib text, description text, qty numeric(18,4), unit text,
  unit_price_cents bigint, base_cents bigint, ibs_cents bigint, cbs_cents bigint, is_cents bigint,
  credit_eligible boolean, credit_cents bigint, calc_memory jsonb, inconsistency jsonb,
  unique (invoice_id, line)
);
create index if not exists items_tenant_invoice on invoice_items (tenant_id, invoice_id);

create table if not exists receivables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade, installment int default 1,
  due_date date not null, expected_date date, paid_at date, amount_cents bigint not null,
  source text not null default 'invoice',
  confidence numeric(3,2) not null default 0.6
);
create index if not exists receivables_tenant_due on receivables (tenant_id, coalesce(expected_date, due_date));

create table if not exists tax_cash_events (
  id bigserial,
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_date date not null, kind cash_event_kind not null, amount_cents bigint not null,
  ref_invoice_id uuid, ref_contract_id uuid, confidence numeric(3,2) not null default 0.6,
  rule_version_id uuid, computed_at timestamptz not null default now(),
  primary key (id, event_date)
) partition by range (event_date);
create index if not exists tce_tenant_date on tax_cash_events (tenant_id, event_date);

do $$
declare d date := date_trunc('month', now() - interval '12 months')::date;
begin
  while d < date_trunc('month', now() + interval '36 months')::date loop
    execute format('create table if not exists %I partition of tax_cash_events for values from (%L) to (%L)',
      'tax_cash_events_' || to_char(d, 'YYYYMM'), d, (d + interval '1 month')::date);
    d := (d + interval '1 month')::date;
  end loop;
end $$;
create table if not exists tax_cash_events_default partition of tax_cash_events default;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text, name text not null, ncm text, cst_default text, cclasstrib_default text,
  cost_cents bigint, current_price_cents bigint, source text default 'invoice', active boolean default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

create table if not exists price_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, target_margin numeric(5,2) not null, fiscal_year int not null,
  assumptions jsonb not null default '{}', status text not null default 'draft',
  approved_by uuid, approved_at timestamptz, rule_version_id uuid, created_at timestamptz default now()
);

create table if not exists price_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  scenario_id uuid not null references price_scenarios(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade, counterparty_id uuid,
  cost_cents bigint, input_credit_cents bigint, floor_price_cents bigint, target_price_cents bigint,
  current_price_cents bigint, delta_pct numeric(6,2), below_floor boolean, memory jsonb
);
create unique index if not exists price_lines_uniq
  on price_lines (scenario_id, product_id, coalesce(counterparty_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists regime_simulations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_at timestamptz default now(), inputs jsonb not null, results jsonb not null,
  recommendation text, next_window date, rule_version_id uuid, report_path text
);

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text, external_id text, bank_name text, masked_number text,
  connected_at timestamptz, status text
);

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references bank_accounts(id) on delete set null,
  booked_at date not null, amount_cents bigint not null,
  description text, counterparty_hint text, matched_receivable_id uuid,
  match_confidence numeric(3,2), external_id text unique
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null, severity alert_severity not null, title text not null,
  payload jsonb not null default '{}',
  created_at timestamptz default now(), read_at timestamptz, resolved_at timestamptz, resolved_by uuid
);
create index if not exists alerts_tenant_open on alerts (tenant_id, created_at desc) where resolved_at is null;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null,
  status job_status not null default 'queued', progress numeric(5,2) default 0, message text, error text,
  params jsonb not null default '{}', result jsonb, requested_by uuid,
  queued_at timestamptz default now(), started_at timestamptz, finished_at timestamptz, worker text
);
create index if not exists jobs_tenant_status on jobs (tenant_id, status, queued_at desc);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null,
  status text not null default 'pending', config jsonb not null default '{}', secret_ref text,
  connected_at timestamptz, last_sync timestamptz, error text
);

do $$
declare t text;
begin
  foreach t in array array['counterparties','invoices','invoice_items','receivables','tax_cash_events',
                           'products','price_scenarios','price_lines','regime_simulations','bank_accounts',
                           'bank_transactions','alerts','jobs','integrations']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_select') then
      execute format('create policy %I on public.%I for select to authenticated using (in_scope(tenant_id))', t||'_select', t);
    end if;
  end loop;
end $$;

grant usage, select on sequence public.tax_cash_events_id_seq to service_role;

grant insert, update, delete on public.products        to authenticated;
grant insert, update, delete on public.price_scenarios to authenticated;
grant update                 on public.alerts          to authenticated;
grant insert, update, delete on public.integrations     to authenticated;

drop policy if exists products_write on products;
create policy products_write on products for all to authenticated
  using (role_in(tenant_id) in ('owner','commercial'))
  with check (role_in(tenant_id) in ('owner','commercial'));

drop policy if exists scenarios_write on price_scenarios;
create policy scenarios_write on price_scenarios for all to authenticated
  using (role_in(tenant_id) in ('owner','commercial'))
  with check (role_in(tenant_id) in ('owner','commercial'));

drop policy if exists alerts_update on alerts;
create policy alerts_update on alerts for update to authenticated
  using (in_scope(tenant_id)) with check (in_scope(tenant_id));

drop policy if exists integrations_write on integrations;
create policy integrations_write on integrations for all to authenticated
  using (can_admin(tenant_id) or role_in(tenant_id) = 'finance')
  with check (can_admin(tenant_id) or role_in(tenant_id) = 'finance');

drop trigger if exists audit_price_scenarios on price_scenarios;
create trigger audit_price_scenarios after insert or update or delete on price_scenarios
  for each row execute function audit_row();
drop trigger if exists audit_integrations on integrations;
create trigger audit_integrations after insert or update or delete on integrations
  for each row execute function audit_row();

drop materialized view if exists mv_cash_timeline;
create materialized view mv_cash_timeline as
select tenant_id, date_trunc('week', event_date)::date as week,
  sum(case when kind = 'tax_out'   then amount_cents else 0 end) as tax_out_cents,
  sum(case when kind = 'credit_in' then amount_cents else 0 end) as credit_in_cents,
  sum(case when kind = 'tax_out' then -amount_cents when kind = 'credit_in' then amount_cents else 0 end) as net_cents,
  avg(confidence) as confidence
from tax_cash_events group by 1, 2;
create unique index if not exists mv_cash_timeline_pk on mv_cash_timeline (tenant_id, week);
revoke all on mv_cash_timeline from anon, authenticated;
grant select on mv_cash_timeline to service_role;