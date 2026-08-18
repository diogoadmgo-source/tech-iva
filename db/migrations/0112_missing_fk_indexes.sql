-- 0112_missing_fk_indexes.sql
-- ESPELHO da migration já aplicada no banco (nomes idênticos aos de pg_indexes).
--
-- Chaves estrangeiras sem índice. A pior era receivables.invoice_id: sem ela
-- cada exclusão em cascata varria a tabela inteira (apagar 100 mil notas
-- estourava o tempo limite; depois do índice: 2,6 s).

create index if not exists receivables_invoice
  on public.receivables (invoice_id);

-- tax_cash_events é particionada por mês: o índice vai na tabela-pai e o
-- Postgres o propaga para todas as partições (inclusive as futuras criadas
-- por ensure_tce_partition).
create index if not exists tce_ref_invoice
  on public.tax_cash_events (ref_invoice_id);

create index if not exists invoices_counterparty
  on public.invoices (counterparty_id);

create index if not exists price_lines_product
  on public.price_lines (product_id);
create index if not exists price_lines_counterparty
  on public.price_lines (counterparty_id);
create index if not exists price_lines_tenant
  on public.price_lines (tenant_id, scenario_id);

create index if not exists banktx_matched
  on public.bank_transactions (matched_receivable_id);

create index if not exists subscriptions_plan
  on public.subscriptions (plan_id);
