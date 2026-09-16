-- 0229_fila_recupera_erro.sql
--
-- Incidente de 15/09/2026, 20:13: a Receita aceitou a solicitacao e devolveu o
-- comprovante de download pelo webhook, mas o passo de baixar falhou com HTTP
-- 429 no endereco de AUTENTICACAO (limite por tempo, diferente do de 2/4
-- consultas por dia). marcarErro pos a linha em status = 'erro', e esta funcao
-- so enxergava 'tiquete_recebido' — a linha ficou orfa: tiquete gravado,
-- payload nulo, arquivo ainda disponivel por 24h, e nenhuma fila a alcanca.
--
-- A fila passa a olhar tambem 'erro', com as MESMAS guardas. Rastreio dos 10
-- pontos que chamam marcarErro confirma que elas ja isolam o caso certo:
--  * erro ANTES de existir tiquete/URL -> excluido por (tiquete ou url not null)
--  * erro DEPOIS do payload gravado    -> excluido por payload is null
--  * erro NO PASSO do download         -> exatamente o que faltava
--
-- O que impede laco: a janela de 48h (inalterada) e o fato de processarPendentes
-- so rodar por clique do usuario — nao ha cron. O download tambem nao debita a
-- cota de 2/4 por dia; so a ABERTURA debita.
--
-- Registro, nao resolvido aqui: rtc_quota_take conhece um limite de 8
-- downloads/dia (kind='download'), mas NENHUM chamador da aplicacao passa esse
-- kind hoje — o download nao e contado do nosso lado. Quem automatizar esta
-- fila (cron/worker) precisa ligar isso antes.
--
-- `create or replace` basta: a lista de colunas devolvidas nao muda (42P13 so
-- aparece quando o retorno muda), e assim os grants (service_role) ficam como
-- estao, sem precisar reemiti-los.

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
     -- v1 (tiquete) ou v2 (URL assinada): basta ter por onde baixar.
     and (a.tiquete_download is not null or a.url_assinada is not null)
     -- Se ja existe payload, o download ja aconteceu; rebaixar nao ajudaria.
     and a.payload is null
     -- 48 h, a validade da URL assinada, contadas do retorno — ou da abertura,
     -- quando o retorno nao veio por webhook. Tambem limita por quanto tempo
     -- uma linha 'erro' fica elegivel.
     and coalesce(a.webhook_recebido_em, a.solicitado_em) > now() - interval '48 hours'
     -- `a.id` desempata: sem ele, linhas do mesmo instante saem em ordem
     -- indefinida, que pode mudar de execucao para execucao.
   order by coalesce(a.webhook_recebido_em, a.solicitado_em), a.id;
$function$;
