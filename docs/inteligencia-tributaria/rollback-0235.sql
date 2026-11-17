-- Reversão da 0235 no fluxa-dev: volta as duas funções EXATAMENTE como estavam
-- (lidas do fluxa-dev em 17/11/2026, 20:58 UTC, por consulta somente leitura).
-- A tabela rtc_webhook_recebido NÃO é apagada: guarda os retornos da Receita
-- recebidos desde a aplicação. Atenção: o código da main chama a função com
-- p_meta; depois desta reversão o retorno da Receita volta a falhar com esse código.
begin;
drop function if exists public.rtc_apuracao_receber_tiquete(text, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
revoke all on function public.rtc_apuracao_receber_tiquete(text, jsonb) from public, anon, authenticated;
grant execute on function public.rtc_apuracao_receber_tiquete(text, jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.rtc_apuracao_expirar_pendentes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare n int;
begin
  update rtc_apuracao
     set status = 'erro', erro = 'A Receita não retornou o tíquete em 2 horas', webhook_ref = null
   where status = 'solicitada' and solicitado_em < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.rtc_apuracao_expirar_pendentes() from public, anon, authenticated;
grant execute on function public.rtc_apuracao_expirar_pendentes() to service_role;

delete from supabase_migrations.schema_migrations where version = '20260926030000';
commit;
