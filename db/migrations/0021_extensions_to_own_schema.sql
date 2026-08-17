-- 0021_extensions_to_own_schema.sql
-- JÁ APLICADA MANUALMENTE NO BANCO (fluxa-dev) pelo mantenedor — arquivo espelho.
-- Move as extensões de `public` para o schema `extensions` (recomendação do linter).
-- Nenhuma função precisou de ajuste: todas usam `search_path = public, extensions`.

create schema if not exists extensions;
grant usage on schema extensions to authenticated, service_role;

alter extension ltree set schema extensions;
alter extension citext set schema extensions;
