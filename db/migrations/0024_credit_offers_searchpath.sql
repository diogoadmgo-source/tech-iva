-- 0024_credit_offers_searchpath.sql
-- JÁ APLICADA MANUALMENTE NO BANCO (fluxa-dev) pelo mantenedor — arquivo espelho.
-- credit_offers tinha ficado apenas com `search_path = public`, diferente das demais.

alter function public.credit_offers(uuid) set search_path = public, extensions;
