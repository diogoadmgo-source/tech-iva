-- 0227_pendentes_download_v2.sql — ESPELHO da migration a aplicar no banco.
--
-- `rtc_apuracao_pendentes_download` não tinha espelho em db/migrations. O corpo
-- abaixo foi conferido contra a função viva (filtro, assinatura de retorno e
-- ordenação); para reconferir depois de aplicar:
--   select pg_get_functiondef(oid) from pg_proc
--    where proname = 'rtc_apuracao_pendentes_download' and pronamespace = 'public'::regnamespace;
--
-- ─────────────────────────── por que esta mudança ───────────────────────────
-- Duas coisas ficaram erradas para a v2 quando ela passou a devolver URL
-- pré-assinada no lugar do tíquete:
--
-- 1. `tiquete_download is not null` deixa a linha v2 órfã. A v2 chega com
--    `url_assinada` e SEM tíquete; se o download inline falhar (rede, 5xx),
--    a linha fica em 'tiquete_recebido' sem fila nenhuma que a pegue — nem
--    esta função, nem a consulta de situação (que só olha 'solicitada'). O
--    download da apuração já existe e simplesmente nunca é retomado.
--
-- 2. A janela de 24 h é menor que a validade da URL. A URL assinada vale 48 h;
--    parar de tentar na metade do prazo é desistir de um download que ainda
--    funcionaria. A janela passa a 48 h para os dois formatos: o tíquete v1
--    não corre risco novo com isso — o download não debita cota (só a abertura
--    debita) e a linha sai da fila assim que `payload` é gravado.
--
-- Também troca `webhook_recebido_em` por `coalesce(webhook_recebido_em,
-- solicitado_em)`: na v2 a URL pode ter chegado pela consulta de situação, e aí
-- não existe instante de webhook para comparar — a linha ficaria de fora da
-- janela por um NULL.
--
-- O RETORNO NÃO MUDA, de propósito. Quem consome é `processarPendentes`, que
-- usa só `id` (e `tenant_id`, para filtrar por empresa) e chama
-- `processarApuracao(id)` — e essa relê a linha inteira do banco, `url_assinada`
-- inclusive. Devolver a URL assinada aqui não adiantaria nada e espalharia um
-- segredo de 48 h por mais uma superfície. `tiquete` passa a vir NULL nas
-- linhas v2: é a leitura correta (não há tíquete) e nenhum consumidor o lê.
--
-- ───────────────────────── por que o drop antes ─────────────────────────
-- `create or replace` não aceita mudar o tipo de retorno: qualquer diferença na
-- lista de colunas — até a ordem entre `cnpj` e `competencia` — devolve
-- "cannot change return type of existing function" (42P13) e a migration não
-- aplica. O drop, como na 0226, garante que o que fica no banco é exatamente o
-- que está escrito aqui, sem depender de a definição viva bater coluna a
-- coluna. O preço é conhecido e está pago logo abaixo: o drop leva junto os
-- grants, por isso o `revoke`/`grant` é reemitido depois do `create`.
--
-- A lista de colunas segue a da função viva, `(id, tenant_id, cnpj,
-- competencia, tiquete)` — não há motivo para mexer nela, e assim quem chama
-- por posição (nenhum consumidor hoje, mas psql e testes manuais o fazem)
-- continua vendo a mesma coisa.

drop function if exists public.rtc_apuracao_pendentes_download();

create function public.rtc_apuracao_pendentes_download()
returns table (id uuid, tenant_id uuid, cnpj text, competencia date, tiquete text)
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  select a.id, a.tenant_id, t.cnpj, a.competencia, a.tiquete_download
    from public.rtc_apuracao a
    join public.tenants t on t.id = a.tenant_id
   where a.status = 'tiquete_recebido'
     -- v1 (tíquete) ou v2 (URL assinada): basta ter por onde baixar.
     and (a.tiquete_download is not null or a.url_assinada is not null)
     and a.payload is null
     -- 48 h, a validade da URL assinada, contadas do retorno — ou da abertura,
     -- quando o retorno não veio por webhook.
     and coalesce(a.webhook_recebido_em, a.solicitado_em) > now() - interval '48 hours'
     -- Mesma chave do `where`, para as duas versões ordenarem pelo mesmo
     -- critério: a linha v2 que chegou pela consulta de situação não tem
     -- `webhook_recebido_em`. `a.id` desempata — sem ele, linhas do mesmo
     -- instante saem em ordem indefinida, que pode mudar de execução para
     -- execução.
   order by coalesce(a.webhook_recebido_em, a.solicitado_em), a.id;
$function$;

revoke all on function public.rtc_apuracao_pendentes_download() from public, anon, authenticated;
grant execute on function public.rtc_apuracao_pendentes_download() to service_role;

-- Pós-voo: uma linha v2 (url_assinada preenchida, tiquete_download nulo) em
-- 'tiquete_recebido' e sem payload tem de aparecer aqui.
-- select id, tiquete from public.rtc_apuracao_pendentes_download();
