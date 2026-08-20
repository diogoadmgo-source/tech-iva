-- 0214_billing_history.sql
-- Histórico de assinatura por empresa dentro do escopo do tenant aberto.
-- Sem security definer: as RLS de tenants/subscriptions/audit_log já limitam o escopo.
create or replace function public.billing_subscriptions_scope(p_tenant uuid)
returns table (
  tenant_id uuid,
  tenant_name text,
  tenant_kind tenant_kind,
  cnpj text,
  subscription_id uuid,
  plan_code text,
  plan_name text,
  status text,
  started_at timestamptz,
  ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  environment text,
  paddle_subscription_id text,
  price_cents integer
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select t.id, t.name, t.kind, t.cnpj,
         s.id, p.code, p.name, s.status, s.started_at, s.ends_at,
         s.current_period_start, s.current_period_end,
         coalesce(s.cancel_at_period_end, false), s.environment,
         s.paddle_subscription_id, p.price_cents
  from tenants base
  join tenants t on t.path <@ base.path
  left join subscriptions s on s.tenant_id = t.id
  left join plans p on p.id = s.plan_id
  where base.id = p_tenant
  order by t.level, t.name, s.started_at desc nulls last, s.id desc;
$$;

grant execute on function public.billing_subscriptions_scope(uuid) to authenticated;

create or replace function public.billing_events_scope(p_tenant uuid, p_limit integer default 200)
returns table (
  event_id bigint,
  tenant_id uuid,
  tenant_name text,
  at timestamptz,
  action text,
  actor_role text,
  status_before text,
  status_after text,
  amount text,
  currency text,
  reference text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select a.id, a.tenant_id, t.name, a.at, a.action, a.actor_role,
         a.before->>'status', a.after->>'status',
         a.after->>'amount', a.after->>'currency', a.entity_id
  from tenants base
  join tenants t on t.path <@ base.path
  join audit_log a on a.tenant_id = t.id
  where base.id = p_tenant
    and a.entity = 'subscriptions'
  order by a.at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

grant execute on function public.billing_events_scope(uuid, integer) to authenticated;