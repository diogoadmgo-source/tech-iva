-- Vincula a assinatura interna ao provedor de pagamento (Paddle).
alter table public.subscriptions
  add column if not exists paddle_subscription_id text,
  add column if not exists paddle_customer_id text,
  add column if not exists paddle_price_id text,
  add column if not exists paddle_product_id text,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists environment text not null default 'sandbox',
  add column if not exists buyer_id uuid;

create unique index if not exists subscriptions_paddle_subscription_id_key
  on public.subscriptions (paddle_subscription_id)
  where paddle_subscription_id is not null;

create index if not exists subscriptions_tenant_env_started
  on public.subscriptions (tenant_id, environment, started_at desc, id desc);

-- price_id humano (starter_monthly, pro_yearly, ...) -> plano interno
create or replace function public.plan_for_price(p_price_id text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p.id
  from public.plans p
  where p.code = split_part(coalesce(p_price_id, ''), '_', 1)
  limit 1
$$;

revoke all on function public.plan_for_price(text) from public;
grant execute on function public.plan_for_price(text) to authenticated, service_role;

comment on column public.subscriptions.environment is 'sandbox (teste) ou live (producao) no provedor de pagamento';
comment on column public.subscriptions.buyer_id is 'usuario que concluiu o checkout';