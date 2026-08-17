-- 0032_audit_role_guards.sql
-- Hardening: elimina qualquer comparacao de papel que possa resultar em NULL.

create or replace function public.can_credit(p_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public','extensions'
as $$
  select public.is_platform()
      or (public.in_scope(p_tenant)
          and public.has_role(p_tenant, array['owner','finance','channel_admin']::member_role[]));
$$;

create or replace function public.can_price(p_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public','extensions'
as $$
  select public.in_scope(p_tenant)
     and (public.is_platform()
          or public.has_role(p_tenant, array['owner','commercial','finance']::member_role[]));
$$;

create or replace function public.job_kind_allowed(p_tenant uuid, p_kind text)
returns boolean language plpgsql stable security definer set search_path to 'public','extensions'
as $$
begin
  if not in_scope(p_tenant) then return false; end if;
  if is_platform() then return true; end if;
  if p_kind = 'reprocess_rules' then
    return false;
  elsif p_kind = 'price_scenario' then
    return has_role(p_tenant, array['owner','commercial','channel_admin','channel_analyst']::member_role[]);
  elsif p_kind in ('ingest_dfe','classify_chain','compute_taxes','project_cash','regime_sim','bank_sync','ingest_erp') then
    return has_role(p_tenant, array['owner','finance','channel_admin','channel_analyst']::member_role[]);
  end if;
  return false;
end $$;

create or replace function public.create_tenant(p_parent uuid, p_kind tenant_kind, p_name text, p_cnpj text default null, p_slug text default null)
returns uuid language plpgsql security definer set search_path to 'public','extensions'
as $$
declare v_id uuid; v_parent_kind tenant_kind;
begin
  if not can_admin(p_parent) then raise exception 'forbidden'; end if;
  perform enforce_mfa(p_parent);
  select kind into v_parent_kind from tenants where id=p_parent;
  if p_kind='platform' then raise exception 'cannot create platform'; end if;
  if p_kind='unit' and v_parent_kind<>'company' then raise exception 'unit must be under company'; end if;
  if p_kind='company' and v_parent_kind not in ('platform','channel') then raise exception 'company must be under platform or channel'; end if;
  if p_kind='channel' and v_parent_kind not in ('platform','channel') then raise exception 'channel must be under platform or channel'; end if;
  insert into tenants (parent_id,kind,name,cnpj,slug,created_by) values (p_parent,p_kind,p_name,p_cnpj,p_slug,auth.uid()) returning id into v_id;
  if p_kind='company' and has_role(p_parent, array['owner']::member_role[]) then
    insert into memberships (user_id,tenant_id,role,created_by) values (auth.uid(),v_id,'owner',auth.uid());
  end if;
  perform log_audit(v_id,'tenant.create','tenant',v_id::text,null,jsonb_build_object('kind',p_kind,'name',p_name,'cnpj',p_cnpj,'parent',p_parent));
  return v_id;
end $$;

create or replace function public.approve_price_scenario(p_scenario uuid)
returns void language plpgsql security definer set search_path to 'public','extensions'
as $$
declare s price_scenarios;
begin
  select * into s from price_scenarios where id = p_scenario;
  if s.id is null then raise exception 'cenario nao encontrado' using errcode = 'P0002'; end if;
  if not in_scope(s.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not is_platform()
     and not has_role(s.tenant_id, array['owner','commercial']::member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.status = 'approved' then return; end if;

  update price_scenarios set status = 'archived'
   where tenant_id = s.tenant_id and status = 'approved' and id <> s.id;

  update price_scenarios
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = s.id;

  perform log_audit(s.tenant_id, 'price.approve', 'price_scenarios', s.id::text,
                    jsonb_build_object('status', s.status),
                    jsonb_build_object('status', 'approved'));
end $$;

create or replace function public.share_regime_simulation(p_simulation uuid, p_note text default null)
returns void language plpgsql security definer set search_path to 'public','extensions'
as $$
declare s regime_simulations; v_parent uuid; v_name text;
begin
  select * into s from regime_simulations where id = p_simulation;
  if s.id is null then raise exception 'simulacao nao encontrada' using errcode = 'P0002'; end if;
  if not in_scope(s.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not is_platform()
     and not has_role(s.tenant_id, array['owner','finance','channel_admin']::member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select t.parent_id, t.name into v_parent, v_name from tenants t where t.id = s.tenant_id;
  if v_parent is null then
    raise exception 'este tenant nao possui canal/pai para compartilhar' using errcode = '55006';
  end if;

  insert into alerts (tenant_id, kind, severity, title, payload)
  values (v_parent, 'regime.simulation_shared', 'info',
          format('%s compartilhou uma simulação de regime', coalesce(v_name, 'Empresa')),
          jsonb_build_object('simulation_id', s.id, 'company_tenant_id', s.tenant_id,
                             'next_window', s.next_window,
                             'note', coalesce(nullif(p_note, ''), s.recommendation)));

  perform log_audit(s.tenant_id, 'regime.share', 'regime_simulations', s.id::text, null,
                    jsonb_build_object('channel_tenant_id', v_parent));
end $$;

-- run_regime_simulation: substitui a checagem manual por has_role mantendo a mensagem de papel
create or replace function public.enforce_regime_role(p_tenant uuid)
returns void language plpgsql stable security definer set search_path to 'public','extensions'
as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
  if is_platform() then return; end if;
  if not has_role(p_tenant, array['owner','finance','channel_admin']::member_role[]) then
    raise exception 'forbidden: papel % nao pode rodar simulacao de regime',
      coalesce(role_in(p_tenant)::text, 'nenhum') using errcode = '42501';
  end if;
end $$;

revoke all on function public.enforce_regime_role(uuid) from public, anon, authenticated;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'run_regime_simulation';

  v_def := replace(v_def,
$old$  if not in_scope(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not is_platform() then
    v_role := role_in(p_tenant);
    if v_role is null or v_role not in ('owner','finance','channel_admin') then
      raise exception 'forbidden: papel % nao pode rodar simulacao de regime', coalesce(v_role::text, 'nenhum')
        using errcode = '42501';
    end if;
  end if;$old$,
$new$  perform enforce_regime_role(p_tenant);$new$);

  if v_def not like '%enforce_regime_role%' then
    raise exception 'run_regime_simulation guard nao encontrado — revisar manualmente';
  end if;
  execute v_def;
end $$;

revoke all on function public.has_role(uuid, member_role[]) from public, anon, authenticated;