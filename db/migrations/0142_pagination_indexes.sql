-- 0142_pagination_indexes.sql
-- ESPELHO da migration que você aplicou no banco (você a chamou de "0141";
-- aqui ela virou 0142 porque 0141_share_expiry_and_public_grants.sql já existia
-- no repositório — mesmo número, conteúdos diferentes, colisão evitada).
--
-- Motivo: a paginação estável passou a ordenar por (coluna_de_data desc, id).
-- Sem um índice que case EXATAMENTE com esse ORDER BY, o Postgres ordena em
-- memória a cada página: imperceptível com 14 linhas, sort de disco com 100 mil.

-- Trilha de auditoria: order by at desc, id desc
create index if not exists audit_log_tenant_at_id
  on public.audit_log (tenant_id, at desc, id desc);

-- Central de alertas: a tela lista TODOS (abertos e resolvidos); o índice
-- parcial anterior cobria só os abertos, então o filtro "resolvidos" caía fora.
create index if not exists alerts_tenant_created_id
  on public.alerts (tenant_id, created_at desc, id);

create index if not exists jobs_tenant_queued_id
  on public.jobs (tenant_id, queued_at desc, id);

create index if not exists invoices_tenant_issued_id
  on public.invoices (tenant_id, issued_at desc, id);

create index if not exists xml_validations_tenant_created_id
  on public.xml_validations (tenant_id, created_at desc, id);

create index if not exists calc_simulations_tenant_created_id
  on public.calc_simulations (tenant_id, created_at desc, id);

-- Busca de contrapartes no servidor (Carteira / seleção de cliente em Preço).
-- (tenant_id, cnpj) atende busca por PREFIXO de CNPJ, que é como a tela passou
-- a consultar; nome com acento/meio de palavra é tratado na 0143 (trigram).
create index if not exists counterparties_tenant_name
  on public.counterparties (tenant_id, name);
create index if not exists counterparties_tenant_cnpj
  on public.counterparties (tenant_id, cnpj);
