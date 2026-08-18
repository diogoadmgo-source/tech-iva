-- 0200_trgm_search_indexes.sql (minha faixa começa em 0200)
-- Índices para BUSCA POR TEXTO das listas paginadas.
--
-- Regra: `ilike 'texto%'` (prefixo) usa índice btree comum; `ilike '%texto%'`
-- (trecho no meio) NÃO usa — o btree fica inútil e o Postgres varre a tabela.
-- Onde a busca infixa é necessária, o índice certo é GIN + trigram.
--
-- Onde cada caso caiu:
--   counterparties.name → infixa (o usuário digita "beta" para achar
--     "Distribuidora Beta"), então trigram.
--   counterparties.cnpj → também infixa, e por um motivo que precisa de conserto:
--     a coluna tem formatos misturados (14 dígitos em algumas linhas,
--     '10000137/0001-07' em outras). Enquanto isso não for normalizado, busca por
--     prefixo de dígitos NÃO encontra as linhas formatadas — ou seja, voltaria a
--     "negar um fato". Trigram atende os dois formatos.
--   audit_log.action / entity → filtros infixos da trilha.

create extension if not exists pg_trgm with schema extensions;

create index if not exists counterparties_name_trgm
  on public.counterparties using gin (name extensions.gin_trgm_ops);
create index if not exists counterparties_cnpj_trgm
  on public.counterparties using gin (cnpj extensions.gin_trgm_ops);

create index if not exists audit_log_action_trgm
  on public.audit_log using gin (action extensions.gin_trgm_ops);
create index if not exists audit_log_entity_trgm
  on public.audit_log using gin (entity extensions.gin_trgm_ops);

-- PENDÊNCIA para uma próxima migration (decisão sua): normalizar
-- counterparties.cnpj para 14 dígitos e passar a busca a prefixo, que é mais
-- barato que trigram. Requer UPDATE de dados + ajuste do ingestor.
