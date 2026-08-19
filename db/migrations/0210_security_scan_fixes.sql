-- 0210_security_scan_fixes.sql — ESPELHO da migration aplicada no banco.
--
-- 1) Funções criadas depois da 0142 nasceram com EXECUTE para PUBLIC (default do
--    Postgres), devolvendo acesso ao papel anon. Revoga de PUBLIC/anon em TODAS as
--    funções de public/credit e mantém authenticated/service_role.
-- 2) search_path fixo na única função que ainda estava sem ele (_test.record).
-- 3) cnpj_registry: a política USING (true) expunha e-mail/telefone/endereço de
--    qualquer CNPJ a qualquer usuário logado. O app lê esse cache SOMENTE pela RPC
--    cnpj_lookup (security definer), então a leitura direta da tabela sai.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','credit')
      and p.prokind = 'f'
      and exists (select 1 from aclexplode(p.proacl) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = '_test' and p.prokind = 'f'
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))
  loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;

drop policy if exists cnpj_registry_select on public.cnpj_registry;
revoke select on public.cnpj_registry from authenticated;
-- service_role (server function de busca) continua gravando/lendo.
