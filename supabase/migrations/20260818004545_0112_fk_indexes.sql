-- Migration 20260818004545 (0112_fk_indexes) — exportada de supabase_migrations.schema_migrations
-- Descoberto no teste de carga: apagar um tenant com 100 mil notas estourava o
-- tempo limite. Causa: receivables.invoice_id não tinha índice, então cada DELETE
-- em cascata varria a tabela inteira procurando filhos. 100 mil varreduras.
-- Isso não afeta só limpeza de teste: afeta exclusão de cliente, correção de
-- ingestão duplicada e qualquer operação em cascata.
create index if not exists receivables_invoice on receivables (invoice_id);
create index if not exists tce_ref_invoice on tax_cash_events (ref_invoice_id);
create index if not exists banktx_matched on bank_transactions (matched_receivable_id);
create index if not exists price_lines_product on price_lines (product_id);
create index if not exists price_lines_counterparty on price_lines (counterparty_id);
create index if not exists invoices_counterparty on invoices (counterparty_id);
create index if not exists subscriptions_plan on subscriptions (plan_id);
