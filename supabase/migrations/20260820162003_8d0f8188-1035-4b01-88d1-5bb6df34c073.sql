-- 0219_rtc_download_single_attempt.sql
-- Um tíquete da Receita permite um único download. Erros não podem voltar para
-- a fila automática, e o webhook precisa devolver o id exato a processar.

CREATE OR REPLACE FUNCTION public.rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v public.rtc_apuracao;
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

  UPDATE public.rtc_apuracao
     SET tiquete_solicitacao = p_payload->>'tiqueteSolicitacao',
         tiquete_download = coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete'),
         status = CASE
           WHEN coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete') IS NULL THEN 'erro'
           ELSE 'tiquete_recebido'
         END,
         erro = CASE
           WHEN coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete') IS NULL
             THEN 'webhook sem tiquete de download'
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
    jsonb_build_object('recebido_em', now())
  );

  RETURN jsonb_build_object('ok', true, 'id', v.id);
END;
$$;

REVOKE ALL ON FUNCTION public.rtc_apuracao_receber_tiquete(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rtc_apuracao_receber_tiquete(text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rtc_apuracao_pendentes_download()
RETURNS TABLE(id uuid, tenant_id uuid, cnpj text, competencia date, tiquete text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT a.id, a.tenant_id, t.cnpj, a.competencia, a.tiquete_download
    FROM public.rtc_apuracao a
    JOIN public.tenants t ON t.id = a.tenant_id
   WHERE a.status = 'tiquete_recebido'
     AND a.tiquete_download IS NOT NULL
     AND a.payload IS NULL
     AND a.webhook_recebido_em > now() - interval '24 hours'
   ORDER BY a.webhook_recebido_em, a.id;
$$;

REVOKE ALL ON FUNCTION public.rtc_apuracao_pendentes_download() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rtc_apuracao_pendentes_download() TO service_role;