-- 0012_security_hardening.sql
-- Correções de segurança (scanner):
-- 1) nenhuma função do schema public chamável por anon
-- 2) helpers internos SECURITY DEFINER não chamáveis pelo cliente
-- 3) RLS + política in_scope em TODAS as partições de tax_cash_events
-- 4) leitura de avatar restrita à pasta do próprio usuário

revoke execute on all functions in schema public from anon;

revoke execute on function public.in_scope(uuid)              from public, anon, authenticated;
revoke execute on function public.role_in(uuid)               from public, anon, authenticated;
revoke execute on function public.can_admin(uuid)             from public, anon, authenticated;
revoke execute on function public.is_platform()               from public, anon, authenticated;
revoke execute on function public.auth_scopes()               from public, anon, authenticated;
revoke execute on function public.job_kind_allowed(uuid,text) from public, anon, authenticated;

do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'tax_cash_events_%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_select') then
      execute format('create policy %I on public.%I for select to authenticated using (in_scope(tenant_id))', t||'_select', t);
    end if;
  end loop;
end $$;

drop policy if exists avatars_read_authenticated on storage.objects;
create policy avatars_read_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
