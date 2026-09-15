-- 0225_apuracao_url_assinada.sql — ESPELHO da migration aplicada no banco.
--
-- A v2 devolve uma URL pré-assinada no lugar do tíquete de download. Ela vale
-- 48 h e autoriza o download por si só — é segredo temporário, por isso fica
-- fora de qualquer retorno ao navegador (a policy de leitura da tabela é por
-- tenant, e a coluna nunca é selecionada pelo front).
alter table public.rtc_apuracao
  add column if not exists url_assinada          text,
  add column if not exists url_assinada_expira_em timestamptz;

comment on column public.rtc_apuracao.url_assinada is
  'URL pré-assinada da v2 (48 h). Segredo temporário: nunca expor ao navegador nem logar.';

-- Passa a aceitar os dois formatos de retorno. Mantém tudo o mais da 0223:
-- janela de 2 horas, uso único do webhook_ref, corpo bruto em webhook_payload.
create or replace function public.rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v public.rtc_apuracao;
  v_tiquete text;
  v_url     text;
BEGIN
  SELECT * INTO v
    FROM public.rtc_apuracao
   WHERE webhook_ref = p_ref
     AND status = 'solicitada'
     AND solicitado_em > now() - interval '2 hours'
   FOR UPDATE;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_tiquete := coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete');
  v_url     := p_payload->>'urlAssinada';

  UPDATE public.rtc_apuracao
     SET webhook_payload = p_payload,
         tiquete_solicitacao = coalesce(p_payload->>'tiqueteSolicitacao', tiquete_solicitacao),
         tiquete_download = v_tiquete,
         url_assinada = v_url,
         url_assinada_expira_em = nullif(p_payload->>'urlAssinadaExpiraEm','')::timestamptz,
         status = CASE
           WHEN v_url IS NOT NULL OR v_tiquete IS NOT NULL THEN 'tiquete_recebido'
           ELSE 'erro'
         END,
         erro = CASE
           WHEN v_url IS NULL AND v_tiquete IS NULL
             THEN coalesce(
                    nullif(p_payload->>'mensagemErro',''),
                    'retorno sem url assinada nem tiquete (corpo bruto em webhook_payload)')
           ELSE NULL
         END,
         webhook_recebido_em = now(),
         webhook_ref = NULL
   WHERE id = v.id;

  PERFORM public.log_audit(
    v.tenant_id, 'apuracao.tiquete', 'rtc_apuracao', v.id::text, NULL,
    jsonb_build_object('recebido_em', now(),
                       'formato', CASE WHEN v_url IS NOT NULL THEN 'v2'
                                       WHEN v_tiquete IS NOT NULL THEN 'v1'
                                       ELSE 'erro' END)
  );

  RETURN jsonb_build_object('ok', true, 'id', v.id);
END;
$function$;
