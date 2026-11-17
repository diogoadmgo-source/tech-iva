-- Reversão da 0242 (motor em massa). Só funções e o papel tax_ingestor: a 0242
-- não cria tabela, coluna, tipo nem política.
-- Os dados que o motor gravou ficam nas tabelas da 0240 (tax_consultations é
-- imutável por desenho) e NÃO são apagados por este script.
-- Rodar só com autorização expressa, como postgres.
begin;
drop function if exists public.tax_portfolio_status(uuid);
drop function if exists public.tax_ingest_finish_run(uuid, text, jsonb, text);
drop function if exists public.tax_ingest_summary(uuid);
drop function if exists public.tax_ingest_classify(uuid, text, int);
drop function if exists public.tax_classify_compute(text);
drop function if exists public.tax_normalize_ecf(text);
drop function if exists public.tax_ingest_batch(uuid, text, jsonb);
drop function if exists public.tax_ingest_file(uuid, text, bigint, text, text[], bigint, bigint, bigint, text);
drop function if exists public.tax_ingest_targets(uuid, text, int);
drop function if exists public.tax_ingest_start_run(text, text[], text, text);
drop function if exists public.tax_ingest_guard(uuid);
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tax_ingestor') then
    -- O papel não é dono de nada (as funções são do postgres); só sobra o uso do schema.
    execute 'revoke all on schema public from tax_ingestor';
    execute 'drop role tax_ingestor';
  end if;
end $$;
delete from supabase_migrations.schema_migrations where version = '20261117220000';
commit;
