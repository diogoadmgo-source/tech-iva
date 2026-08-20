-- Estado e apoio da ingestão automática via NFeDistribuicaoDFe (Ambiente Nacional).
-- Aplicada via MCP (Supabase) em 20/08/2026 com o nome dfe_distribuicao_estado_e_cofre.

create table if not exists public.dfe_sync_state (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  ult_nsu   text not null default '0',
  max_nsu   text not null default '0',
  last_stat integer,
  synced_at timestamptz
);
comment on table public.dfe_sync_state is 'Último NSU consumido da distribuição DF-e por tenant. Regra do AN: nunca repetir chamada com ultNSU=maxNSU (656).';

create table if not exists public.dfe_pending_manifest (
  tenant_id uuid not null references tenants(id) on delete cascade,
  chave text not null check (chave ~ '^[0-9]{44}$'),
  emitente text,
  valor_cents bigint,
  detectado_em timestamptz not null default now(),
  manifestado_em timestamptz,
  cstat integer,
  primary key (tenant_id, chave)
);
comment on table public.dfe_pending_manifest is 'resNFe recebidos; manifestado_em preenchido quando a Ciência da Operação (210210) foi aceita (135/136/573).';

create table if not exists public.dfe_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  nsu text not null,
  schema text not null,
  xml text not null,
  received_at timestamptz not null default now(),
  unique (tenant_id, nsu)
);

alter table public.dfe_sync_state enable row level security;
alter table public.dfe_pending_manifest enable row level security;
alter table public.dfe_events enable row level security;
do $$ begin
  create policy dfe_sync_state_read on public.dfe_sync_state for select using (in_scope(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy dfe_pending_manifest_read on public.dfe_pending_manifest for select using (in_scope(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy dfe_events_read on public.dfe_events for select using (in_scope(tenant_id));
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public) values ('dfe-raw','dfe-raw', false)
on conflict (id) do nothing;
