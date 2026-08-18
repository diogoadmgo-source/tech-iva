-- 0051_credit_gated_by_feature.sql
-- ESPELHO da migration já aplicada no banco (não reaplicar em produção).
-- Todas as RPCs de crédito passam por can_credit(); a flag fecha o módulo inteiro.
-- Nem a plataforma opera crédito em tenant com o módulo desligado.

create or replace function public.can_credit(p_tenant uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'extensions'
as $$
  select public.feature_enabled(p_tenant, 'credit')
     and ( public.is_platform()
        or ( public.in_scope(p_tenant)
             and public.has_role(p_tenant, array['owner','finance','channel_admin']::member_role[]) ) );
$$;

revoke all on function public.can_credit(uuid) from public;
grant execute on function public.can_credit(uuid) to authenticated;
