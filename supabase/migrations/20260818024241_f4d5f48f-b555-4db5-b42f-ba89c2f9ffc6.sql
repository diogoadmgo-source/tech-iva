-- 0200_register_credential_execute_authenticated.sql
-- O upload de certificado chamava register_credential com service_role, e a guarda
-- interna has_role(auth.uid()) sempre falhava com 'forbidden'. A chamada passa a ser
-- feita com a identidade do usuário; a guarda continua sendo a autoridade.
grant execute on function public.register_credential(
  uuid, text, credential_kind, text, text, text, text, date, date, text[], text[], text, boolean
) to authenticated;

grant execute on function public.certificado_confere_titular(uuid, text) to authenticated;