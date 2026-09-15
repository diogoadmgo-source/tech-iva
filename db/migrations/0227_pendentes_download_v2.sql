-- 0227_pendentes_download_v2.sql — ESPELHO da migration a aplicar no banco.
--
-- ATENÇÃO, antes de aplicar: `rtc_apuracao_pendentes_download` não tinha
-- espelho em db/migrations; o corpo abaixo foi reescrito a partir do filtro
-- confirmado no banco (status='tiquete_recebido' and tiquete_download is not
-- null and payload is null and webhook_recebido_em > now() - interval
-- '24 hours') e da assinatura de retorno já publicada em types.ts
-- (id, tenant_id, competencia, cnpj, tiquete). Confira contra o que está lá:
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
-- Do corpo original só o filtro é fato confirmado. `language sql` e o
-- `order by solicitado_em` (mais antiga primeiro) são escolha desta reescrita:
-- confira o functiondef antes de aplicar. Se a ORDEM das colunas de retorno no
-- banco não for a de baixo, o `create or replace` recusa ("cannot change return
-- type"); nesse caso é ajustar a ordem aqui, não dropar a função — o drop leva
-- junto os grants.

create or replace function public.rtc_apuracao_pendentes_download()
returns table (id uuid, tenant_id uuid, competencia date, cnpj text, tiquete text)
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  select a.id, a.tenant_id, a.competencia, t.cnpj, a.tiquete_download
    from public.rtc_apuracao a
    join public.tenants t on t.id = a.tenant_id
   where a.status = 'tiquete_recebido'
     -- v1 (tíquete) ou v2 (URL assinada): basta ter por onde baixar.
     and (a.tiquete_download is not null or a.url_assinada is not null)
     and a.payload is null
     -- 48 h, a validade da URL assinada, contadas do retorno — ou da abertura,
     -- quando o retorno não veio por webhook.
     and coalesce(a.webhook_recebido_em, a.solicitado_em) > now() - interval '48 hours'
   order by a.solicitado_em;
$function$;

revoke all on function public.rtc_apuracao_pendentes_download() from public, anon, authenticated;
grant execute on function public.rtc_apuracao_pendentes_download() to service_role;

-- Pós-voo: uma linha v2 (url_assinada preenchida, tiquete_download nulo) em
-- 'tiquete_recebido' e sem payload tem de aparecer aqui.
-- select id, tiquete from public.rtc_apuracao_pendentes_download();
