-- Migration 20260818010257 (0140_revoke_anon_grants) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- DEFESA EM PROFUNDIDADE: tirar do anon os privilégios de tabela
-- ============================================================================
-- Descoberto na revisão do link público de simulação: o papel `anon` tinha
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE em 231 tabelas do schema public. Isso vem
-- do padrão da plataforma (grant amplo no schema), não de nada que fizemos.
--
-- HOJE ISSO NÃO VAZA NADA: a RLS está ligada em todas as tabelas e todas as
-- políticas são "to authenticated", então o anon lê zero linhas — testado.
--
-- MAS a proteção está apoiada em uma única camada. Basta alguém, um dia, criar
-- uma política com "to public" por descuido, ou desligar RLS numa tabela para
-- depurar, e o anon passa a ler (ou APAGAR) tudo. Num sistema que guarda a
-- operação fiscal de terceiros, uma camada só é pouco.
-- Aqui a segunda camada: sem privilégio de tabela, nem uma política errada salva o anon.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on schema public from anon;
grant usage on schema public to anon;   -- necessário para o PostgREST responder 401/404 corretamente

-- E o padrão para as PRÓXIMAS tabelas: quem criar tabela nova não concede a anon
-- sem querer.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Mesmo tratamento no schema de crédito (já estava fechado, reforça).
revoke all on all tables in schema credit from anon;
revoke all on schema credit from anon;
