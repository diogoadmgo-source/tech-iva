ALTER TABLE public.rtc_apuracao
  ADD COLUMN IF NOT EXISTS access_token_ref text;

CREATE OR REPLACE FUNCTION public.rtc_apuracao_substituir_competencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS rtc_apuracao_substituir_competencia_trg ON public.rtc_apuracao;
CREATE TRIGGER rtc_apuracao_substituir_competencia_trg
AFTER UPDATE OF status ON public.rtc_apuracao
FOR EACH ROW
WHEN (NEW.status = 'disponivel' AND OLD.status IS DISTINCT FROM 'disponivel')
EXECUTE FUNCTION public.rtc_apuracao_substituir_competencia();