-- Migration 20260818011940 (0141_indices_paginacao_estavel) — exportada de supabase_migrations.schema_migrations
-- A revisão de paginação trocou a ordenação das listas para incluir desempate
-- estável (ex.: auditoria por at desc, id desc). Sem índice correspondente, o
-- banco ordena tudo em memória a cada página: rápido com 14 linhas, lento com
-- 100 mil. Índices alinhados à ordenação real das telas.

-- auditoria: at desc + id desc (desempate)
create index if not exists audit_tenant_at_id on audit_log (tenant_id, at desc, id desc);

-- alertas: a tela lista TODOS (não só abertos) com filtro, então o índice parcial
-- existente não serve para a listagem paginada geral
create index if not exists alerts_tenant_created_id on alerts (tenant_id, created_at desc, id);

-- jobs: o Centro de Processamentos lista por tenant e data, sem filtrar status
create index if not exists jobs_tenant_queued_id on jobs (tenant_id, queued_at desc, id);

-- notas: listagem paginada por data com desempate
create index if not exists invoices_tenant_issued_id on invoices (tenant_id, issued_at desc, id);

-- validações de XML e simulações: as duas telas novas listam por data
create index if not exists xmlval_tenant_created_id on xml_validations (tenant_id, created_at desc, id);
create index if not exists calc_sim_tenant_created_id on calc_simulations (tenant_id, created_at desc, id);

-- busca no servidor por CNPJ/nome na Carteira: sem isto, o LIKE varre a tabela
create index if not exists counterparties_tenant_name on counterparties (tenant_id, name);
create index if not exists counterparties_tenant_cnpj on counterparties (tenant_id, cnpj);
