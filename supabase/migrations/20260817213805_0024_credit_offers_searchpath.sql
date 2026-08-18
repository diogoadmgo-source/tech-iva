-- Migration 20260817213805 (0024_credit_offers_searchpath) — exportada de supabase_migrations.schema_migrations
-- credit_offers ficou com search_path = public (sem extensions); padroniza
alter function public.credit_offers(uuid) set search_path = public, extensions;
