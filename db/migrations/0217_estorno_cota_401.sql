-- 0217_estorno_cota_401.sql
-- ESPELHO da migration aplicada no banco (não reaplicar).
--
-- Devolve a consulta de hoje consumida por uma falha de autenticação do
-- ambiente (HTTP 401 do proxy que protege o serviço): a Receita nunca foi
-- consultada, portanto a cota diária não podia ter sido debitada.
update rtc_api_quota
   set solicitacoes = greatest(solicitacoes - 1, 0)
 where cnpj8 = '23813386'
   and dia = current_date;
