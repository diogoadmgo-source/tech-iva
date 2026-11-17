-- 0250 — Ajustes de performance apontados pelos advisors do Supabase (17/11/2026)
--
-- As políticas de RLS reescritas abaixo têm exatamente a mesma condição, só trocam auth.uid() por (select auth.uid())
-- para o Postgres avaliar o usuário uma vez por consulta, não uma vez por linha.
--
-- 1. Índices nas chaves estrangeiras que não tinham índice (13).
-- 2. Remove o índice duplicado price_lines_uniq (idêntico a price_lines_uk).
-- 3. Reescreve 4 políticas de RLS com (select auth.uid()).
-- 4. Corrige audit_overview, que deixava ler dados de auditoria de outra empresa.

-- ---------------------------------------------------------------- 1. índices
create index if not exists profiles_last_tenant_idx            on public.profiles (last_tenant);
create index if not exists api_keys_tenant_idx                 on public.api_keys (tenant_id);
create index if not exists invoices_rule_version_idx           on public.invoices (rule_version_id);
create index if not exists price_scenarios_tenant_idx          on public.price_scenarios (tenant_id);
create index if not exists regime_simulations_tenant_idx       on public.regime_simulations (tenant_id);
create index if not exists bank_accounts_tenant_idx            on public.bank_accounts (tenant_id);
create index if not exists bank_transactions_account_idx       on public.bank_transactions (account_id);
create index if not exists calc_simulations_rule_version_idx   on public.calc_simulations (rule_version_id);
create index if not exists audit_findings_invoice_idx          on public.audit_findings (invoice_id);
create index if not exists credit_offers_policy_idx            on credit.offers (policy_id);
create index if not exists credit_contracts_offer_idx          on credit.contracts (offer_id);
create index if not exists credit_ledger_tenant_idx            on credit.ledger (tenant_id);
create index if not exists credit_repayments_tenant_idx        on credit.repayments (tenant_id);

-- ------------------------------------------------------ 2. índice duplicado
-- price_lines_uk (0010) e price_lines_uniq (20260817193737) cobrem as mesmas
-- colunas com a mesma expressão. Fica o original.
drop index if exists public.price_lines_uniq;

-- ------------------------------------------- 3. RLS sem reavaliar por linha
alter policy profiles_self_select on public.profiles
  using (user_id = (select auth.uid()));

alter policy profiles_self_update on public.profiles
  using (user_id = (select auth.uid()));

alter policy profiles_self_insert on public.profiles
  with check (user_id = (select auth.uid()));

alter policy memberships_select on public.memberships
  using (user_id = (select auth.uid()) or in_scope(tenant_id));

-- --------------------------------- 4. audit_overview sem checagem de escopo
-- SECURITY DEFINER e executável por qualquer usuário logado, mas não conferia
-- se o tenant pedido é do usuário: bastava passar o id de outra empresa para
-- ler a contagem de achados e o valor em risco dela. Agora, fora do escopo,
-- devolve null. Mesmo corpo da 20260822001948, só com o filtro no fim.
create or replace function public.audit_overview(p_tenant uuid, p_desde date default null)
returns jsonb language sql stable security definer set search_path to 'public','extensions' as $$
  with base as (
    select count(*) itens_auditados
    from invoice_items it join invoices i on i.id = it.invoice_id
    where it.tenant_id = p_tenant
      and i.issued_at >= coalesce(p_desde, premissa_inicio_vigencia())
  ), ach as (
    select count(*) achados, count(distinct invoice_item_id) itens_com_achado,
           coalesce(sum(valor_risco_cents),0) risco
    from audit_findings where tenant_id = p_tenant and status = 'aberto'
  )
  select jsonb_build_object(
    'itens_auditados', base.itens_auditados,
    'itens_com_achado', ach.itens_com_achado,
    'achados', ach.achados,
    'conformidade_pct', case when base.itens_auditados = 0 then null
      else round(100.0 * (base.itens_auditados - ach.itens_com_achado) / base.itens_auditados, 1) end,
    'valor_risco_cents', ach.risco,
    'rule_version', (select calc_version from rule_versions where is_current limit 1)
  ) from base, ach
  where in_scope(p_tenant);
$$;
revoke all on function public.audit_overview(uuid, date) from public, anon;
grant execute on function public.audit_overview(uuid, date) to authenticated, service_role;
