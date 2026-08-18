-- Migration 20260817213316 (0021_extensions_to_own_schema) — exportada de supabase_migrations.schema_migrations
-- ltree e citext saem do schema public (recomendação do linter do Supabase).
-- As funções já usam search_path = public, extensions, então continuam resolvendo.
alter extension ltree set schema extensions;
alter extension citext set schema extensions;
grant usage on schema extensions to authenticated, anon, service_role;
