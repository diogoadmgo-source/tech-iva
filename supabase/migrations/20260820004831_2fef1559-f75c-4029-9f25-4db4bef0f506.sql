-- 0212: plano efetivo herdado pela hierarquia (empresa vê o plano do ancestral que assinou)
create or replace function public.tenant_plan(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v tenants;
  v_holder tenants;
  v_holder_id uuid;
  v_sub_id uuid;
  v_sub subscriptions;
  v_plan plans;
  v_uso jsonb;
  v_ativo boolean;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select * into v from tenants where id = p_tenant;
  if v.id is null then raise exception 'tenant nao encontrado'; end if;

  select a.id, s.id into v_holder_id, v_sub_id
  from tenants a
  join subscriptions s on s.tenant_id = a.id
  where v.path <@ a.path
    and s.status in ('trialing','active','past_due','canceled')
    and (s.ends_at is null or s.ends_at > now())
  order by a.level desc, s.started_at desc
  limit 1;

  if v_sub_id is null then
    return jsonb_build_object(
      'tenant_id', v.id, 'assinatura', null, 'plano', null,
      'herdado_de', null, 'ativo', false, 'uso', '{}'::jsonb
    );
  end if;

  select * into v_sub from subscriptions where id = v_sub_id;
  select * into v_holder from tenants where id = v_holder_id;
  select * into v_plan from plans where id = v_sub.plan_id;

  v_ativo := v_sub.status in ('trialing','active','past_due')
             or (v_sub.status = 'canceled' and v_sub.ends_at > now());

  select jsonb_build_object(
    'companies', (select count(*) from tenants c
                   where c.path <@ v_holder.path and c.kind in ('company','unit') and c.status = 'active'),
    'users', (select count(distinct m.user_id) from memberships m
               join tenants t2 on t2.id = m.tenant_id
               where t2.path <@ v_holder.path),
    'invoices_month', (select count(*) from invoices i
                        join tenants t3 on t3.id = i.tenant_id
                        where t3.path <@ v_holder.path
                          and i.issued_at >= date_trunc('month', now()))
  ) into v_uso;

  return jsonb_build_object(
    'tenant_id', v.id,
    'assinatura', jsonb_build_object('id', v_sub.id, 'status', v_sub.status,
                                     'started_at', v_sub.started_at, 'ends_at', v_sub.ends_at),
    'plano', jsonb_build_object('id', v_plan.id, 'code', v_plan.code, 'name', v_plan.name,
                                'price_cents', v_plan.price_cents,
                                'limits', coalesce(v_plan.limits, '{}'::jsonb),
                                'features', coalesce(v_plan.features, '{}'::jsonb)),
    'herdado_de', case when v_holder.id = v.id then null
                       else jsonb_build_object('id', v_holder.id, 'name', v_holder.name, 'kind', v_holder.kind) end,
    'ativo', v_ativo,
    'uso', v_uso
  );
end $$;

revoke all on function public.tenant_plan(uuid) from public;
grant execute on function public.tenant_plan(uuid) to authenticated;

create or replace function public.tenant_plans_scope(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare v tenants; v_rows jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select * into v from tenants where id = p_tenant;

  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'id', c.id, 'name', c.name, 'kind', c.kind, 'cnpj', c.cnpj,
             'plano', public.tenant_plan(c.id)
           ) as x
    from tenants c
    where c.path <@ v.path and c.id <> v.id and c.kind in ('company','unit') and c.status = 'active'
  ) s;

  return v_rows;
end $$;

revoke all on function public.tenant_plans_scope(uuid) from public;
grant execute on function public.tenant_plans_scope(uuid) to authenticated;