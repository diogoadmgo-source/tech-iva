-- 0229_fila_recupera_erro.sql — ESPELHO da migration a aplicar no banco.
--
-- Corpo de `rtc_apuracao_pendentes_download` levantado do banco em 15/09/2026
-- (o texto está reproduzido no chamado que motivou esta migration). Só o
-- `where` muda; para reconferir depois de aplicar:
--   select pg_get_functiondef(oid) from pg_proc
--    where proname = 'rtc_apuracao_pendentes_download' and pronamespace = 'public'::regnamespace;
--
-- ─────────────────────────── o incidente de hoje ───────────────────────────
-- 15/09/2026, 20:13: a Receita aceitou uma solicitação e devolveu o
-- comprovante de download pelo webhook (`tiquete_download` gravado,
-- status = 'tiquete_recebido'). O passo seguinte, baixar, falhou com HTTP 429
-- no endereço de AUTENTICAÇÃO da Receita (limite de chamadas por tempo — um
-- limite diferente do de 2/4 consultas por dia). `marcarErro`
-- (src/lib/rtc-apuracao.server.ts) pôs a linha em status = 'erro'. Como esta
-- função só enxergava 'tiquete_recebido', a linha ficou órfã: tiquete
-- gravado, payload nulo, arquivo ainda disponível na Receita por 24 h — e
-- nenhuma fila a alcança. O usuário gastou uma consulta do dia sem receber o
-- dado. Não é um caso isolado: acontece toda vez que o download tropeça por
-- causa transitória (limite de chamadas, oscilação de rede, token vencido —
-- ver o comentário de `processarApuracao` sobre o token de client_credentials
-- expirar no meio do fluxo assíncrono).
--
-- O CONSERTO: a fila passa a olhar também `status = 'erro'`, com as MESMAS
-- guardas que já valiam para 'tiquete_recebido' — tíquete ou URL assinada
-- presente, `payload` ainda nulo, dentro da janela de 48 h. Não é preciso
-- separar por que a linha caiu em erro: as guardas abaixo já filtram para
-- fora tudo que não é "webhook recebido, download não concluído".
--
-- ───────────────────── por que as guardas já bastam ─────────────────────
-- Levantamento de TODO ponto que chama `marcarErro` em rtc-apuracao.server.ts
-- (linhas 825, 901, 1097, 1107, 1115, 1171, 1181, 1254, 1282, 1293 em
-- 15/09/2026), para confirmar o que cada guarda exclui:
--
-- * Erro ANTES de existir tíquete/URL (falha ao abrir a solicitação, falha de
--   credencial na abertura, "Receita recusou a apuração", "passou dos 240 min
--   de processamento", "concluída sem URL assinada"): a linha nunca chega a
--   ter `tiquete_download` nem `url_assinada` preenchidos. Excluída por
--   `(a.tiquete_download is not null or a.url_assinada is not null)` — não há
--   por onde baixar, então não há o que recuperar aqui.
-- * Erro DEPOIS do download (falha ao gravar/ingerir o JSON já baixado): o
--   `payload` já foi persistido antes desse erro (processarApuracao grava o
--   JSON bruto antes de chamar `rtc_apuracao_ingest_json`). Excluída por
--   `a.payload is null` — reabaixar um arquivo já salvo não ajudaria; o
--   problema é outro (ingestão), fora do escopo desta fila.
-- * Erro NO PASSO do download em si (o caso de hoje: 429/rede/token vencido
--   ao trocar o tíquete ou a URL assinada pelo arquivo): a linha tem tíquete
--   ou URL preenchidos e `payload` nulo. É exatamente o caso que faltava, e é
--   o único que sobra depois das duas exclusões acima.
--
-- ────────────────────── o que impede laço infinito ──────────────────────
-- 1. Janela de 48 h (já existente, inalterada): mesmo prazo de validade da
--    URL assinada. Uma linha de agosto em 'erro' com tíquete fica de fora
--    porque `coalesce(webhook_recebido_em, solicitado_em)` dela é muito mais
--    velho que `now() - interval '48 hours'` — a condição não muda de
--    comportamento para linhas antigas, só passa a valer também para
--    status = 'erro' dentro da janela.
-- 2. Esta fila não roda em cron: `processarPendentes` só é chamada por
--    `apuracaoProcessarPendentes` (src/lib/rtc-apuracao.functions.ts), uma
--    server function atrás de `requireSupabaseAuth` acionada pelo hook
--    `useProcessarPendentesApuracao` (src/lib/rtc.ts) — ou seja, por um clique
--    do usuário na tela de recuperação manual. Não existe hoje um agendador
--    (pg_cron ou equivalente) chamando esta função sozinha. Sem chamador
--    automático, não há laço: cada rodada tenta uma vez cada linha pendente,
--    e só volta a tentar se o usuário clicar de novo.
-- 3. O download NÃO debita a cota de 2/4 consultas por dia — só a ABERTURA da
--    solicitação debita (`rtc_apuracao_solicitar`, ver 0226/0228). O caminho
--    de erro do download nunca chama `rtc_apuracao_solicitar` de novo; ele só
--    repete o passo de baixar o mesmo tíquete/URL já emitidos. Repetir esta
--    fila não arrisca a cota escassa que bloqueia o usuário de abrir consultas
--    novas.
--
-- Registro, para não perder de vista: `rtc_quota_take` já sabe de um limite de
-- 8 downloads/dia por CNPJ do lado da Receita (kind = 'download', ver 0080),
-- mas nenhum chamador em src/lib/rtc-apuracao.server.ts passa esse kind hoje —
-- o download não é gated por essa cota na aplicação. Isso não é resolvido
-- aqui: não é o defeito relatado (o comprovante ficar órfão), e a janela de
-- 48 h + a ausência de cron já bastam para esta fila não virar um laço. Fica
-- para quem eventualmente automatizar esta fila (cron/worker): nesse dia,
-- ligar `rtc_quota_take(cnpj8, 'download', ...)` no passo de baixar deixa de
-- ser opcional.
--
-- ─────────────────── por que não filtrar erro "definitivo" ───────────────────
-- Cogitado: excluir da fila um erro que a Receita tenha recusado em definitivo
-- (tíquete inválido/expirado do lado dela), para não gastar uma tentativa de
-- download à toa. Não dá para fazer isso com segurança hoje: `erro` é texto
-- livre (a mensagem da exceção, cortada em 400 caracteres — ver `marcarErro`),
-- sem um campo estruturado que diga "transitório" vs. "definitivo". Casar por
-- substring do texto (ex. procurar "429" ou "expirad") é frágil — muda com a
-- mensagem exata da Receita ou da nossa camada de erro, e um casamento errado
-- esconderia silenciosamente uma linha que era recuperável. Como o único custo
-- de tentar de novo um erro definitivo é uma chamada HTTP a mais (a cota de
-- 2/4 por dia não é tocada, e o item acima cobre o limite de 8/dia do lado da
-- Receita), o preço de tentar sem filtrar é baixo — e menor que o risco de
-- excluir por engano um comprovante ainda recuperável, que é exatamente o
-- defeito que esta migration existe para consertar.
--
-- ──────────────────────── por que create or replace ────────────────────────
-- A lista de colunas devolvidas não muda — continua
-- `(id uuid, tenant_id uuid, cnpj text, competencia date, tiquete text)`,
-- igual à 0227. Só o `where` ganha mais uma condição. `create or replace`
-- basta (42P13 só aparece quando a lista de colunas do retorno muda) e é
-- preferível ao `drop` + `revoke`/`grant`: os grants desta função
-- (service_role apenas) ficam como estão, sem precisar reemiti-los.

create or replace function public.rtc_apuracao_pendentes_download()
returns table (id uuid, tenant_id uuid, cnpj text, competencia date, tiquete text)
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  select a.id, a.tenant_id, t.cnpj, a.competencia, a.tiquete_download
    from public.rtc_apuracao a
    join public.tenants t on t.id = a.tenant_id
   where a.status in ('tiquete_recebido', 'erro')
     -- v1 (tíquete) ou v2 (URL assinada): basta ter por onde baixar. Sem isto
     -- (nas duas versões de status), a linha nunca teve tíquete/URL — não há
     -- o que recuperar, seja qual for o motivo do erro.
     and (a.tiquete_download is not null or a.url_assinada is not null)
     -- Se já existe payload, o download já aconteceu (o erro, se houve, foi
     -- depois — ao gravar/ingerir). Baixar de novo não ajudaria.
     and a.payload is null
     -- 48 h, a validade da URL assinada, contadas do retorno — ou da abertura,
     -- quando o retorno não veio por webhook. Mesma janela de antes; agora
     -- também limita por quanto tempo uma linha 'erro' fica elegível.
     and coalesce(a.webhook_recebido_em, a.solicitado_em) > now() - interval '48 hours'
     -- Mesma chave do `where`, para as duas versões e os dois status
     -- ordenarem pelo mesmo critério. `a.id` desempata — sem ele, linhas do
     -- mesmo instante saem em ordem indefinida, que pode mudar de execução
     -- para execução.
   order by coalesce(a.webhook_recebido_em, a.solicitado_em), a.id;
$function$;

-- Pós-voo: a linha do incidente (status = 'erro', tiquete_download
-- preenchido, payload nulo, dentro de 48 h) tem de aparecer aqui.
-- select id, tiquete from public.rtc_apuracao_pendentes_download();
-- Uma linha de agosto em 'erro' com tíquete NÃO pode aparecer (fora da
-- janela de 48 h):
-- select id, status, tiquete_download, webhook_recebido_em, solicitado_em
--   from public.rtc_apuracao
--  where status = 'erro' and tiquete_download is not null
--    and coalesce(webhook_recebido_em, solicitado_em) <= now() - interval '48 hours';
