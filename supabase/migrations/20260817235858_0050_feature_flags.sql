-- Migration 20260817235858 (0050_feature_flags) — exportada de supabase_migrations.schema_migrations
-- Módulos opcionais por empresa. O crédito (motor de lucro) fica construído mas
-- DESLIGADO: só faz sentido com fundo/banco por trás, e essa decisão é da plataforma,
-- não do cliente nem do canal. Mecanismo genérico para futuros módulos.

create table tenant_features (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  feature    text not null,
  enabled    boolean not null default false,
  enabled_by uuid,
  enabled_at timestamptz,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature)
);
create index tenant_features_enabled on tenant_features (feature) where enabled;

alter table tenant_features enable row level security;

-- Todos no escopo LEEM (o front precisa saber o que mostrar);
-- só a plataforma ESCREVE.
create policy tf_select on tenant_features for select to authenticated using (in_scope(tenant_id));
create policy tf_write  on tenant_features for all    to authenticated
  using (is_platform()) with check (is_platform());
grant select on tenant_features to authenticated;
grant all on tenant_features to service_role;

create trigger audit_tenant_features after insert or update or delete on tenant_features
  for each row execute function audit_row();

-- Consulta: um módulo está ligado para este tenant?
-- Herda do ancestral mais próximo que tenha registro explícito — assim a plataforma
-- pode ligar para um canal inteiro de uma vez.
create or replace function feature_enabled(p_tenant uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
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
grant execute on function feature_enabled(uuid, text) to authenticated;

-- Guarda usada dentro das RPCs do módulo
create or replace function require_feature(p_tenant uuid, p_feature text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not feature_enabled(p_tenant, p_feature) then
    raise exception 'feature disabled: %', p_feature;
  end if;
end $$;
revoke execute on function require_feature(uuid, text) from public, anon, authenticated;

-- Só a plataforma liga/desliga, com auditoria e motivo obrigatório ao ligar
create or replace function set_tenant_feature(p_tenant uuid, p_feature text, p_enabled boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
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
grant execute on function set_tenant_feature(uuid, text, boolean, text) to authenticated;

-- Lista para o painel da plataforma
create or replace function platform_features(p_feature text default 'credit')
returns table (tenant_id uuid, tenant_name text, cnpj text, kind tenant_kind,
               enabled boolean, enabled_at timestamptz, note text)
language plpgsql stable security definer set search_path = public, extensions as $$
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
grant execute on function platform_features(text) to authenticated;

-- Estado inicial: DESLIGADO para todo mundo, explicitamente registrado.
insert into tenant_features (tenant_id, feature, enabled, note)
select id, 'credit', false, 'Desligado por padrão — depende de fundo/banco parceiro'
from tenants where kind in ('company','channel')
on conflict do nothing;
