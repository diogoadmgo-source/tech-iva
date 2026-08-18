create index if not exists counterparties_cnpj_trgm
  on public.counterparties using gin (cnpj extensions.gin_trgm_ops);