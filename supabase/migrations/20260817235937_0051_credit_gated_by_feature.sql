-- Migration 20260817235937 (0051_credit_gated_by_feature) — exportada de supabase_migrations.schema_migrations
-- can_credit é o ponto único por onde passam TODAS as RPCs do módulo de crédito
-- (credit_offers, credit_offer_detail, credit_contracts, credit_contract_detail,
--  credit_generate_offers, accept_credit_offer). Basta exigir o módulo aqui.
-- Nem a plataforma escapa: se o módulo está desligado para a empresa, ninguém opera
-- crédito nela — evita que um admin gere oferta por engano num cliente sem contrato
-- de funding. Para operar, a plataforma liga o módulo explicitamente (com motivo).
create or replace function can_credit(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select public.feature_enabled(p_tenant, 'credit')
     and ( public.is_platform()
        or ( public.in_scope(p_tenant)
             and public.has_role(p_tenant, array['owner','finance','channel_admin']::member_role[]) ) );
$$;
grant execute on function can_credit(uuid) to authenticated;

-- Mensagem clara quando o bloqueio for do módulo (e não de papel):
-- as RPCs continuam levantando 'forbidden', mas o front pode consultar
-- feature_enabled(tenant,'credit') para decidir se mostra o menu.
comment on function can_credit(uuid) is
  'Permite operar crédito: exige o módulo credit habilitado para o tenant (tenant_features) E papel adequado.';
