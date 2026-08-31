-- 0223_apuracao_diagnostico_completo.sql — ESPELHO da migration aplicada no banco.
--
-- Fecha os dois pontos cegos que impediam explicar uma falha sem gastar cota:
--
-- 1) chamada_diag: diagnóstico das chamadas anteriores ao download (token e
--    solicitação). Antes disto só o download guardava diagnóstico, então uma
--    recusa no passo do token deixava apenas "HTTP 400" sem causa — foi
--    exatamente o que aconteceu em 31/08/2026. Formato:
--       { "token": {status, ok, headers, corpo_recorte, em},
--         "solicitar": {status, ok, headers, corpo_recorte, em} }
--    Nunca carrega credencial nem access_token. O recorte do corpo do token só
--    é gravado em FALHA: a resposta de sucesso contém o próprio access_token.
--
-- 2) webhook_payload: corpo bruto do retorno da Receita, gravado ANTES de ler
--    qualquer campo. Sem ele, um retorno com nome de campo diferente do
--    esperado vira 'erro' e a evidência se perde junto com a chamada gasta.
--
-- Colunas aditivas e nulas: nenhuma linha existente muda. Os grants de
-- rtc_apuracao são de tabela (pg_class.relacl), não de coluna, então as novas
-- colunas já nascem cobertas — nenhum GRANT adicional é necessário.

alter table public.rtc_apuracao
  add column if not exists chamada_diag    jsonb,
  add column if not exists webhook_payload jsonb;

comment on column public.rtc_apuracao.chamada_diag is
  'Diagnóstico das chamadas à Receita antes do download (token, solicitar). Sem credencial nem token.';
comment on column public.rtc_apuracao.webhook_payload is
  'Corpo bruto recebido no retorno da Receita, gravado antes de qualquer leitura de campo.';

-- Passa a gravar o corpo bruto do retorno. O resto da função é idêntico à
-- versão anterior: mesma janela de 2 horas, mesmo uso único do webhook_ref,
-- mesma tolerância entre 'tiqueteDownload' e 'tiquete'.
create or replace function public.rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v public.rtc_apuracao;
  v_tiquete text;
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

  UPDATE public.rtc_apuracao
     SET webhook_payload = p_payload,
         tiquete_solicitacao = p_payload->>'tiqueteSolicitacao',
         tiquete_download = v_tiquete,
         status = CASE WHEN v_tiquete IS NULL THEN 'erro' ELSE 'tiquete_recebido' END,
         erro = CASE
           WHEN v_tiquete IS NULL
             THEN 'webhook sem tiquete de download (corpo bruto guardado em webhook_payload)'
           ELSE NULL
         END,
         webhook_recebido_em = now(),
         webhook_ref = NULL
   WHERE id = v.id;

  PERFORM public.log_audit(
    v.tenant_id,
    'apuracao.tiquete',
    'rtc_apuracao',
    v.id::text,
    NULL,
    jsonb_build_object('recebido_em', now(), 'tem_tiquete', v_tiquete IS NOT NULL)
  );

  RETURN jsonb_build_object('ok', true, 'id', v.id);
END;
$function$;
