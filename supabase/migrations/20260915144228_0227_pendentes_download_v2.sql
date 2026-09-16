-- 0227_pendentes_download_v2.sql
--
-- A fila de recuperação de download só enxergava linha v1: exigia
-- `tiquete_download is not null`. A 0225 passou a produzir linha v2 em
-- `status='tiquete_recebido'` com `url_assinada` preenchida e SEM tíquete —
-- e essa linha, se o download inline falhasse, não era pega por fila nenhuma:
-- nem por esta, nem pela consulta de situação (que só olha 'solicitada').
-- A janela de 24 h também estava errada para a v2: a URL assinada dura 48 h.
--
-- `drop` antes do `create` porque `create or replace` não muda assinatura de
-- retorno ("cannot change return type of existing function", SQLSTATE 42P13) —
-- mesma saída que a 0226 usou. O `drop` leva junto os grants, por isso o
-- `revoke`/`grant` é reemitido depois do `create`.

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
