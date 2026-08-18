-- Migration 20260817213357 (0023_accept_credit_offer_use_enforce_mfa) — exportada de supabase_migrations.schema_migrations
-- Unifica a regra de MFA: accept_credit_offer passa a exigir aal2 sempre (contratação
-- de crédito é a exceção do doc 01 §1.4: owner/finance também precisam de step-up),
-- usando a mesma mensagem padrão 'MFA required' das demais RPCs.
create or replace function require_aal2() returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if current_aal() <> 'aal2' then raise exception 'MFA required'; end if;
end $$;
revoke execute on function require_aal2() from public, anon, authenticated;
