-- 0140_revoke_anon_privileges.sql — ESPELHO da migration aplicada no banco.
--
-- O papel `anon` vinha com SELECT/INSERT/UPDATE/DELETE/TRUNCATE em todas as
-- tabelas do schema public (padrão da plataforma Supabase). Nada vazava: a RLS
-- está ligada em todas as tabelas e todas as políticas são `to authenticated`,
-- então o anon lia zero linhas. Mas a proteção dependia de UMA camada — bastaria
-- uma política `to public` por descuido, ou RLS desligada para depurar, e o anon
-- passaria a ler (ou apagar) a operação fiscal de terceiros.
--
-- Defesa em profundidade: o anon fica sem privilégio nenhum, e os privilégios
-- padrão passam a não conceder nada a ele em objetos NOVOS.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on schema public from anon;

revoke all on all tables in schema credit from anon;
revoke all on all sequences in schema credit from anon;
revoke all on all functions in schema credit from anon;
revoke all on schema credit from anon;

-- objetos novos não nascem acessíveis ao anon
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema credit revoke all on tables from anon;
alter default privileges in schema credit revoke all on sequences from anon;
alter default privileges in schema credit revoke all on functions from anon;

-- authenticated e service_role permanecem intactos: nenhuma leitura da aplicação
-- passa pelo anon. A única leitura pública do produto (link /s/:token) é feita
-- por server function com service role, projetando só os campos do cálculo.
