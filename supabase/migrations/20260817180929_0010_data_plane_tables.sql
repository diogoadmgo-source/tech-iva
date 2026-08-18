-- Migration 20260817180929 (0010_data_plane_tables) — exportada de supabase_migrations.schema_migrations
-- FASE 02 / Seção A — plano de dados
create type invoice_direction as enum ('out','in');
create type party_role as enum ('customer','supplier','both');
create type regime_kind as enum ('simples','simples_hibrido','presumido','real','mei','pf','imune','desconhecido');
create type cash_event_kind as enum ('tax_out','credit_in','provision','credit_advance','loan_in','loan_out');
create type job_status as enum ('queued','running','done','failed','canceled');
create type alert_severity as enum ('info','warning','critical');

create table counterparties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cnpj text not null, name text, role party_role not null default 'both',
  regime regime_kind not null default 'desconhecido',
  regime_source text, regime_checked_at timestamptz,
  credit_transfer_pct numeric(5,2),
  revenue_share_pct numeric(5,2), purchase_share_pct numeric(5,2),
  risk_flag text, meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, cnpj)
);
create index counterparties_tenant_role on counterparties (tenant_id, role);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  direction invoice_direction not null, model text not null,
  access_key text not null unique, number text, series text,
  issued_at date not null, counterparty_id uuid references counterparties(id),
  total_cents bigint not null, ibs_cents bigint default 0, cbs_cents bigint default 0,
  is_cents bigint default 0, credit_cents bigint default 0,
  raw_xml_path text, status text not null default 'authorized',
  rule_version_id uuid references rule_versions(id),
  inconsistencies jsonb not null default '[]',
  ingested_at timestamptz not null default now()
);
create index invoices_tenant_date on invoices (tenant_id, issued_at desc);
create index invoices_tenant_party on invoices (tenant_id, counterparty_id);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  line int not null, product_id uuid, ncm text, cst text, cclasstrib text,
  description text, qty numeric(18,4), unit text,
  unit_price_cents bigint, base_cents bigint,
  ibs_cents bigint, cbs_cents bigint, is_cents bigint,
  credit_eligible boolean, credit_cents bigint,
  calc_memory jsonb, inconsistency jsonb,
  unique (invoice_id, line)
);
create index items_tenant_invoice on invoice_items (tenant_id, invoice_id);

create table receivables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  installment int default 1, due_date date not null, expected_date date, paid_at date,
  amount_cents bigint not null, source text not null default 'invoice',
  confidence numeric(3,2) not null default 0.6
);
create index receivables_tenant_due on receivables (tenant_id, coalesce(expected_date,due_date));

create table tax_cash_events (
  id bigserial,
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_date date not null, kind cash_event_kind not null, amount_cents bigint not null,
  ref_invoice_id uuid, ref_contract_id uuid,
  confidence numeric(3,2) not null default 0.6,
  rule_version_id uuid, computed_at timestamptz not null default now(),
  primary key (id, event_date)
) partition by range (event_date);
create index tce_tenant_date on tax_cash_events (tenant_id, event_date);

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text, name text not null, ncm text, cst_default text, cclasstrib_default text,
  cost_cents bigint, current_price_cents bigint, source text default 'invoice',
  active boolean default true,
  unique (tenant_id, sku)
);

create table price_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, target_margin numeric(5,2) not null, fiscal_year int not null,
  assumptions jsonb not null default '{}', status text not null default 'draft',
  approved_by uuid, approved_at timestamptz, rule_version_id uuid,
  created_at timestamptz default now()
);
create table price_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  scenario_id uuid not null references price_scenarios(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  counterparty_id uuid references counterparties(id) on delete cascade,
  cost_cents bigint, input_credit_cents bigint, floor_price_cents bigint,
  target_price_cents bigint, current_price_cents bigint,
  delta_pct numeric(6,2), below_floor boolean, memory jsonb
);
create unique index price_lines_uk on price_lines (scenario_id, product_id, coalesce(counterparty_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index price_lines_tenant on price_lines (tenant_id, scenario_id);

create table regime_simulations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_at timestamptz default now(), inputs jsonb not null, results jsonb not null,
  recommendation text, next_window date, rule_version_id uuid, report_path text
);

create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text, external_id text, bank_name text, masked_number text,
  connected_at timestamptz, status text
);
create table bank_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references bank_accounts(id) on delete cascade,
  booked_at date not null, amount_cents bigint not null, description text,
  counterparty_hint text, matched_receivable_id uuid references receivables(id),
  match_confidence numeric(3,2), external_id text unique
);
create index banktx_tenant_date on bank_transactions (tenant_id, booked_at desc);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null, severity alert_severity not null, title text not null,
  payload jsonb not null default '{}',
  created_at timestamptz default now(), read_at timestamptz,
  resolved_at timestamptz, resolved_by uuid
);
create index alerts_tenant_open on alerts (tenant_id, created_at desc) where resolved_at is null;

create table jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null, status job_status not null default 'queued',
  progress numeric(5,2) default 0, message text, error text,
  params jsonb not null default '{}', result jsonb, requested_by uuid,
  queued_at timestamptz default now(), started_at timestamptz, finished_at timestamptz, worker text
);
create index jobs_tenant_status on jobs (tenant_id, status, queued_at desc);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null, status text not null default 'pending',
  config jsonb not null default '{}', secret_ref text,
  connected_at timestamptz, last_sync timestamptz, error text,
  unique (tenant_id, kind)
);
