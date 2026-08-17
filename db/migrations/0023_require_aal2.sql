-- 0023_require_aal2.sql
-- JÁ APLICADA MANUALMENTE NO BANCO (fluxa-dev) pelo mantenedor — arquivo espelho.
-- Helper único de MFA do projeto. Mensagem exata: 'MFA required'.
-- Não é exposta ao front (execute revogado de authenticated); é usada só
-- internamente por RPCs security definer.

create or replace function public.require_aal2()
returns void language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if current_aal() <> 'aal2' then raise exception 'MFA required'; end if;
end $$;

revoke execute on function public.require_aal2() from public, anon, authenticated;
