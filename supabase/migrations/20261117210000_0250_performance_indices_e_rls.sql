-- 0250 — Ajustes de performance apontados pelos advisors do Supabase (17/11/2026)
--
-- Nada aqui muda regra de acesso: as políticas de RLS reescritas abaixo têm
-- exatamente a mesma condição, só trocam auth.uid() por (select auth.uid())
-- para o Postgres avaliar o usuário uma vez por consulta, não uma vez por linha.
--
-- 1. Índices nas chaves estrangeiras que não tinham índice (13).
-- 2. Remove o índice duplicado price_lines_uniq (idêntico a price_lines_uk).
-- 3. Reescreve 4 políticas de RLS com (select auth.uid()).

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
