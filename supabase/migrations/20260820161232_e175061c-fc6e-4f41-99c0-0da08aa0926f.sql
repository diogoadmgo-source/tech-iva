CREATE OR REPLACE FUNCTION public.rtc_apuracao_substituir_competencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.status = 'disponivel' AND OLD.status IS DISTINCT FROM 'disponivel' THEN
    DELETE FROM public.rtc_apuracao
     WHERE tenant_id = NEW.tenant_id
       AND competencia = NEW.competencia
       AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rtc_apuracao_substituir_competencia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rtc_apuracao_substituir_competencia() TO service_role;

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
   WHERE a.status IN ('tiquete_recebido', 'erro')
     AND a.tiquete_download IS NOT NULL
     AND a.payload IS NULL
     AND a.webhook_recebido_em > now() - interval '24 hours'
   ORDER BY a.webhook_recebido_em;
$$;

REVOKE ALL ON FUNCTION public.rtc_apuracao_pendentes_download() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rtc_apuracao_pendentes_download() TO service_role;