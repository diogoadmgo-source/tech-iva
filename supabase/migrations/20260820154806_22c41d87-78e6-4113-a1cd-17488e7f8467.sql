-- 0217_estorno_cota_401.sql
-- Devolve a consulta de hoje consumida por uma falha de autenticação do
-- ambiente (HTTP 401 do proxy): a Receita nunca foi consultada.
update rtc_api_quota
   set solicitacoes = greatest(solicitacoes - 1, 0)
 where cnpj8 = '23813386'
   and dia = current_date;