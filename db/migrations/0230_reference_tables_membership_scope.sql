-- 0230_reference_tables_membership_scope.sql — ESPELHO da migration aplicada no banco.
--
-- As tabelas de referência (matriz CST × cClassTrib, versões de regra, cache de
-- cálculo, rtc_class_trib) tinham política SELECT com USING (true): qualquer sessão
-- autenticada, inclusive uma sem vínculo nenhum com a plataforma, lia a base inteira.
-- Passa a exigir vínculo real (membership), sem perda de acesso para usuários do
-- produto — todo usuário do app pertence a pelo menos um tenant.

create or replace function public.has_any_membership()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m where m.user_id = auth.uid()
  )
$$;

revoke all on function public.has_any_membership() from public, anon;
grant execute on function public.has_any_membership() to authenticated;
grant execute on function public.has_any_membership() to service_role;

drop policy if exists calc_classtrib_aplicavel_select on public.calc_classtrib_aplicavel;
create policy calc_classtrib_aplicavel_select on public.calc_classtrib_aplicavel
  for select to authenticated using (has_any_membership());

drop policy if exists calc_classtrib_matriz_select on public.calc_classtrib_matriz;
create policy calc_classtrib_matriz_select on public.calc_classtrib_matriz
  for select to authenticated using (has_any_membership());

drop policy if exists calc_rule_select on public.calc_rule_cache;
create policy calc_rule_select on public.calc_rule_cache
  for select to authenticated using (has_any_membership());

drop policy if exists rtc_ct_select on public.rtc_class_trib;
create policy rtc_ct_select on public.rtc_class_trib
  for select to authenticated using (has_any_membership());

drop policy if exists rules_select on public.rule_versions;
create policy rules_select on public.rule_versions
  for select to authenticated using (has_any_membership());
