create extension if not exists pg_trgm with schema extensions;

-- Busca por trecho no meio do nome ('%beta%'): índice comum não serve, trigram serve.
create index if not exists counterparties_name_trgm
  on public.counterparties using gin (name extensions.gin_trgm_ops);

-- Filtros de ação/entidade da trilha de auditoria também usam '%texto%'.
create index if not exists audit_log_action_trgm
  on public.audit_log using gin (action extensions.gin_trgm_ops);
create index if not exists audit_log_entity_trgm
  on public.audit_log using gin (entity extensions.gin_trgm_ops);