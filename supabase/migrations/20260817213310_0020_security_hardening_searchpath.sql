-- Migration 20260817213310 (0020_security_hardening_searchpath) — exportada de supabase_migrations.schema_migrations
alter function public.regime_iva_rate(integer) set search_path = public, extensions;
alter function public.price_credit_factor(regime_kind) set search_path = public, extensions;
