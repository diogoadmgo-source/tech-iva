-- 0220: diagnóstico da resposta de download da apuração (status HTTP + headers)
ALTER TABLE public.rtc_apuracao
  ADD COLUMN IF NOT EXISTS download_diag jsonb;

COMMENT ON COLUMN public.rtc_apuracao.download_diag IS
  'Diagnóstico da última tentativa de download: status HTTP, headers relevantes, caminho de token usado (guardado|novo) e recorte do corpo em caso de erro. Sem credencial nem token.';