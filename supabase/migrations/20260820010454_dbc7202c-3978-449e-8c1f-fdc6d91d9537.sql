-- 0213_billing_webhook_audit.sql
-- Registro de auditoria para eventos de cobrança recebidos do provedor de pagamento.
-- O webhook roda com service role (sem auth.uid()), então log_audit() não serve:
-- ela deriva ator e papel do JWT. Esta função grava o ator como o próprio webhook.
create or replace function public.log_billing_event(
  p_tenant uuid,
  p_action text,
  p_entity_id text,
  p_before jsonb default null,
  p_after jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_tenant, null, 'payments_webhook', p_action, 'subscriptions', p_entity_id, p_before, p_after);
end $$;

revoke execute on function public.log_billing_event(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.log_billing_event(uuid,text,text,jsonb,jsonb) to service_role;

-- Deduplicação de webhooks: o provedor reenvia o mesmo evento em caso de falha.
create table if not exists public.billing_webhook_events (
  event_id text primary key,
  event_type text not null,
  environment text not null,
  subscription_id text,
  tenant_id uuid,
  received_at timestamptz not null default now()
);

grant all on public.billing_webhook_events to service_role;

alter table public.billing_webhook_events enable row level security;

create policy "Somente plataforma lê eventos de cobrança"
  on public.billing_webhook_events for select
  to authenticated
  using (is_platform_admin());