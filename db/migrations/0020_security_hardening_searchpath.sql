-- 0020_security_hardening_searchpath.sql
-- JÁ APLICADA MANUALMENTE NO BANCO (fluxa-dev) pelo mantenedor — arquivo espelho.
-- Fixa search_path nas duas funções que ainda estavam sem ele.
-- REGRA DO PROJETO: toda função nova nasce com `set search_path = public, extensions`.

alter function public.regime_iva_rate(integer) set search_path = public, extensions;
alter function public.price_credit_factor(regime_kind) set search_path = public, extensions;
