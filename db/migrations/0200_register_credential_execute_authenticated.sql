-- 0200_register_credential_execute_authenticated.sql
-- Corrige o bug bloqueante do upload de certificado ("forbidden").
--
-- Causa: o server function chamava register_credential com service_role. A guarda
-- interna da função é has_role(p_tenant, ...), que depende de auth.uid(); com
-- service_role auth.uid() é NULL, então a guarda SEMPRE recusava — e o
-- created_by da credencial ficava nulo.
--
-- Correção: a chamada passa a ser feita com a identidade do usuário (client
-- autenticado do server function), e o banco continua sendo a autoridade da regra.
grant execute on function public.register_credential(
  uuid, text, credential_kind, text, text, text, text, date, date, text[], text[], text, boolean
) to authenticated;

-- mesma razão: a verificação de titular é consultada com a identidade do usuário
grant execute on function public.certificado_confere_titular(uuid, text) to authenticated;
