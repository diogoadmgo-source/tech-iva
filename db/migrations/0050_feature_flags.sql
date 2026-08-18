-- 0050_feature_flags.sql
-- ESPELHO da migration já aplicada no banco (não reaplicar em produção).
-- Feature flags por tenant, com herança pelo ancestral mais próximo (ltree).
-- Estado inicial: módulo 'credit' DESLIGADO para todos, registrado explicitamente.

create table if not exists public.tenant_features (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature text not null,
  enabled boolean not null default false,
  enabled_by uuid,
  enabled_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature)
);

grant select on public.tenant_features to authenticated;
grant all on public.tenant_features to service_role;

alter table public.tenant_features enable row level security;

drop policy if exists tenant_features_read on public.tenant_features;
create policy tenant_features_read on public.tenant_features
  for select to authenticated using (public.in_scope(tenant_id));

drop policy if exists tenant_features_write on public.tenant_features;
create policy tenant_features_write on public.tenant_features
  for all to authenticated using (public.is_platform()) with check (public.is_platform());

drop trigger if exists tenant_features_audit on public.tenant_features;
create trigger tenant_features_audit
  after insert or update or delete on public.tenant_features
  for each row execute function public.audit_row();

-- Herda do ancestral mais próximo com registro explícito.
create or replace function public.feature_enabled(p_tenant uuid, p_feature text)
returns boolean
language sql stable security definer
set search_path to 'public', 'extensions'
as $$
  select coalesce((
    select f.enabled
    from tenants target
    join tenants anc on target.path <@ anc.path
    join tenant_features f on f.tenant_id = anc.id and f.feature = p_feature
    where target.id = p_tenant
    order by anc.level desc
    limit 1
  ), false);
$$;

revoke all on function public.feature_enabled(uuid, text) from public;
grant execute on function public.feature_enabled(uuid, text) to authenticated;

-- Só plataforma, exige MFA (aal2) e motivo ao habilitar. Auditado como 'feature.<flag>'.
create or replace function public.set_tenant_feature(
  p_tenant uuid, p_feature text, p_enabled boolean, p_note text default null
) returns void
language plpgsql security definer
set search_path to 'public', 'extensions'
as $$
declare v_before boolean;
begin
  if not is_platform() then raise exception 'forbidden'; end if;
  perform require_aal2();
  if p_feature not in ('credit') then raise exception 'unknown feature: %', p_feature; end if;
  if p_enabled and coalesce(btrim(p_note),'') = '' then
    raise exception 'informe o motivo/contrato ao habilitar o modulo';
  end if;

  select feature_enabled(p_tenant, p_feature) into v_before;

  insert into tenant_features (tenant_id, feature, enabled, enabled_by, enabled_at, note, updated_at)
  values (p_tenant, p_feature, p_enabled, auth.uid(), case when p_enabled then now() end, p_note, now())
  on conflict (tenant_id, feature) do update
    set enabled = excluded.enabled,
        enabled_by = auth.uid(),
        enabled_at = case when excluded.enabled then now() else tenant_features.enabled_at end,
        note = excluded.note,
        updated_at = now();

  perform log_audit(p_tenant, 'feature.'||p_feature, 'tenant_feature', p_tenant::text,
                    jsonb_build_object('enabled', v_before),
                    jsonb_build_object('enabled', p_enabled, 'note', p_note));
end $$;

revoke all on function public.set_tenant_feature(uuid, text, boolean, text) from public;
grant execute on function public.set_tenant_feature(uuid, text, boolean, text) to authenticated;

-- Painel da plataforma: estado do módulo por tenant.
create or replace function public.platform_features(p_feature text default 'credit')
returns table(tenant_id uuid, tenant_name text, cnpj text, kind tenant_kind,
              enabled boolean, enabled_at timestamptz, note text)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $$
begin
  if not is_platform() then raise exception 'forbidden'; end if;
  return query
  select t.id, t.name, t.cnpj, t.kind,
         coalesce(f.enabled,false), f.enabled_at, f.note
  from tenants t
  left join tenant_features f on f.tenant_id = t.id and f.feature = p_feature
  where t.kind in ('company','channel') and t.status='active'
  order by coalesce(f.enabled,false) desc, t.name;
end $$;

revoke all on function public.platform_features(text) from public;
grant execute on function public.platform_features(text) to authenticated;

-- Estado inicial explícito: desligado para todos os canais e empresas.
insert into public.tenant_features (tenant_id, feature, enabled, note)
select t.id, 'credit', false, 'estado inicial: modulo desligado (sem fundo parceiro)'
from public.tenants t
where t.kind in ('platform','channel','company','unit')
on conflict (tenant_id, feature) do nothing;
