-- Status do tenant só muda pela plataforma
create or replace function public.tenants_guard_status()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status is distinct from old.status
     and coalesce(auth.role(),'') <> 'service_role'
     and not public.is_platform() then
    raise exception 'Somente a plataforma pode alterar o status da empresa' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tenants_guard_status() from public, anon, authenticated;
drop trigger if exists tenants_guard_status on public.tenants;
create trigger tenants_guard_status before update on public.tenants
  for each row execute function public.tenants_guard_status();

-- Assinaturas: escrita direta só pela plataforma (cobrança via webhook/service role)
drop policy if exists subs_write on public.subscriptions;
create policy subs_write on public.subscriptions for all to authenticated
  using (public.is_platform()) with check (public.is_platform());

-- audit_overview respeita o escopo do chamador
create or replace function public.audit_overview(p_tenant uuid, p_desde date default null)
returns jsonb language sql stable security definer set search_path to 'public','extensions' as $function$
  with base as (
    select count(*) itens_auditados
    from invoice_items it join invoices i on i.id = it.invoice_id
    where it.tenant_id = p_tenant
      and i.issued_at >= coalesce(p_desde, premissa_inicio_vigencia())
  ), ach as (
    select count(*) achados, count(distinct invoice_item_id) itens_com_achado,
           coalesce(sum(valor_risco_cents),0) risco
    from audit_findings where tenant_id = p_tenant and status = 'aberto'
  )
  select jsonb_build_object(
    'itens_auditados', base.itens_auditados,
    'itens_com_achado', ach.itens_com_achado,
    'achados', ach.achados,
    'conformidade_pct', case when base.itens_auditados = 0 then null
      else round(100.0 * (base.itens_auditados - ach.itens_com_achado) / base.itens_auditados, 1) end,
    'valor_risco_cents', ach.risco,
    'rule_version', (select calc_version from rule_versions where is_current limit 1)
  ) from base, ach
  where public.in_scope(p_tenant);
$function$;
