-- 0018_pricing.sql
create or replace function can_price(p_tenant uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v member_role;
begin
  if not in_scope(p_tenant) then return false; end if;
  if is_platform() then return true; end if;
  v := role_in(p_tenant);
  return v is not null and v in ('owner','commercial','finance');
end $$;

create or replace function price_credit_factor(p_regime regime_kind)
returns numeric language sql immutable as $$
  select case p_regime
    when 'real' then 1.00
    when 'presumido' then 1.00
    when 'simples_hibrido' then 0.60
    when 'simples' then 0.30
    else 0.00
  end
$$;

create or replace function price_scenario_compute(p_scenario uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  s price_scenarios;
  v_rate numeric;
  v_var numeric;
  v_margin numeric;
  v_cp uuid;
  v_count int := 0;
begin
  select * into s from price_scenarios where id = p_scenario;
  if s.id is null then raise exception 'cenario nao encontrado' using errcode = 'P0002'; end if;
  if not can_price(s.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.status <> 'draft' then raise exception 'cenario nao editavel' using errcode = '55006'; end if;

  v_rate := regime_iva_rate(s.fiscal_year);
  v_var := coalesce((s.assumptions->>'var_exp_pct')::numeric, 0.05);
  v_margin := least(greatest(s.target_margin / 100.0, 0), 0.90);
  v_cp := nullif(s.assumptions->>'counterparty_id', '')::uuid;

  delete from price_lines where scenario_id = s.id;

  insert into price_lines (
    tenant_id, scenario_id, product_id, counterparty_id, cost_cents, input_credit_cents,
    floor_price_cents, target_price_cents, current_price_cents, delta_pct, below_floor, memory
  )
  select
    s.tenant_id, s.id, p.id, v_cp,
    coalesce(p.cost_cents, 0),
    calc.credit_cents,
    calc.floor_cents,
    calc.target_cents,
    coalesce(p.current_price_cents, 0),
    case when coalesce(p.current_price_cents, 0) > 0
      then round(((calc.target_cents - p.current_price_cents)::numeric / p.current_price_cents) * 100, 2)
      else null end,
    coalesce(p.current_price_cents, 0) > 0 and p.current_price_cents < calc.floor_cents,
    jsonb_build_object(
      'iva_rate', v_rate, 'var_exp_pct', v_var, 'target_margin', v_margin,
      'credit_factor', calc.factor, 'fiscal_year', s.fiscal_year,
      'formula', 'floor = (custo - credito) / (1 - aliquota - despesas); alvo = piso / (1 - margem)'
    )
  from products p
  cross join lateral (
    select
      cf.factor,
      round(coalesce(p.cost_cents, 0) * v_rate * cf.factor)::bigint as credit_cents,
      greatest(round((coalesce(p.cost_cents, 0) - coalesce(p.cost_cents, 0) * v_rate * cf.factor)
        / greatest(1 - v_rate - v_var, 0.05)), 0)::bigint as floor_cents,
      greatest(round(((coalesce(p.cost_cents, 0) - coalesce(p.cost_cents, 0) * v_rate * cf.factor)
        / greatest(1 - v_rate - v_var, 0.05)) / greatest(1 - v_margin, 0.10)), 0)::bigint as target_cents
    from (
      select case when v_cp is null then 1.00
                  else coalesce((select price_credit_factor(c.regime) from counterparties c where c.id = v_cp), 1.00)
             end as factor
    ) cf
  ) calc
  where p.tenant_id = s.tenant_id and p.active;

  select count(*) into v_count from price_lines where scenario_id = s.id;
  return v_count;
end $$;

create or replace function price_scenario_create(
  p_tenant uuid,
  p_name text,
  p_target_margin numeric,
  p_fiscal_year int,
  p_counterparty uuid default null,
  p_var_exp_pct numeric default 0.05
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_job uuid;
  v_lines int;
begin
  if not can_price(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_fiscal_year < 2027 or p_fiscal_year > 2033 then
    raise exception 'ano fiscal fora da transicao (2027-2033)' using errcode = '22023';
  end if;
  if p_counterparty is not null
     and not exists (select 1 from counterparties c where c.id = p_counterparty and c.tenant_id = p_tenant) then
    raise exception 'cliente nao pertence ao tenant' using errcode = '42501';
  end if;

  insert into price_scenarios (tenant_id, name, target_margin, fiscal_year, assumptions, status, rule_version_id)
  values (
    p_tenant,
    coalesce(nullif(trim(p_name), ''), format('Cenário %s', p_fiscal_year)),
    p_target_margin,
    p_fiscal_year,
    jsonb_strip_nulls(jsonb_build_object(
      'var_exp_pct', coalesce(p_var_exp_pct, 0.05),
      'counterparty_id', p_counterparty
    )),
    'draft',
    (select id from rule_versions where is_current limit 1)
  )
  returning id into v_id;

  v_job := enqueue_job(p_tenant, 'price_scenario', jsonb_build_object('scenario_id', v_id));
  v_lines := price_scenario_compute(v_id);
  update jobs set status = 'done', finished_at = now(),
                  result = jsonb_build_object('lines', v_lines, 'scenario_id', v_id)
   where id = v_job;

  perform log_audit(p_tenant, 'price.scenario_create', 'price_scenarios', v_id::text, null,
                    jsonb_build_object('lines', v_lines, 'fiscal_year', p_fiscal_year,
                                       'target_margin', p_target_margin, 'counterparty_id', p_counterparty));
  return v_id;
end $$;

create or replace function price_scenario_detail(p_scenario uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s price_scenarios;
  v_lines jsonb;
  v_totals jsonb;
begin
  select * into s from price_scenarios where id = p_scenario;
  if s.id is null then raise exception 'cenario nao encontrado' using errcode = 'P0002'; end if;
  if not in_scope(s.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_lines
  from (
    select jsonb_build_object(
      'id', l.id, 'product_id', l.product_id, 'sku', p.sku, 'name', p.name, 'ncm', p.ncm,
      'cost_cents', l.cost_cents, 'input_credit_cents', l.input_credit_cents,
      'floor_price_cents', l.floor_price_cents, 'target_price_cents', l.target_price_cents,
      'current_price_cents', l.current_price_cents, 'delta_pct', l.delta_pct,
      'below_floor', l.below_floor, 'memory', l.memory,
      'counterparty_id', l.counterparty_id, 'counterparty_name', c.name
    ) as x
    from price_lines l
    join products p on p.id = l.product_id
    left join counterparties c on c.id = l.counterparty_id
    where l.scenario_id = s.id
  ) q;

  select jsonb_build_object(
      'lines', count(*),
      'revenue_current_cents', coalesce(sum(current_price_cents), 0),
      'revenue_target_cents', coalesce(sum(target_price_cents), 0),
      'avg_delta_pct', round(coalesce(avg(delta_pct), 0), 2),
      'avg_margin_pct', round(coalesce(avg(case when target_price_cents > 0
        then (target_price_cents - floor_price_cents)::numeric / target_price_cents * 100 end), 0), 2),
      'below_floor', coalesce(sum(case when below_floor then 1 else 0 end), 0)
    ) into v_totals
  from price_lines where scenario_id = s.id;

  return jsonb_build_object(
    'scenario', jsonb_build_object(
      'id', s.id, 'tenant_id', s.tenant_id, 'name', s.name, 'target_margin', s.target_margin,
      'fiscal_year', s.fiscal_year, 'assumptions', s.assumptions, 'status', s.status,
      'approved_at', s.approved_at, 'created_at', s.created_at,
      'iva_rate', regime_iva_rate(s.fiscal_year)
    ),
    'lines', v_lines,
    'totals', v_totals
  );
end $$;

create or replace function approve_price_scenario(p_scenario uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s price_scenarios;
  v_role member_role;
begin
  select * into s from price_scenarios where id = p_scenario;
  if s.id is null then raise exception 'cenario nao encontrado' using errcode = 'P0002'; end if;
  if not in_scope(s.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not is_platform() then
    v_role := role_in(s.tenant_id);
    if v_role is null or v_role not in ('owner','commercial') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
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

create or replace function update_product_price(
  p_product uuid,
  p_cost_cents bigint default null,
  p_current_price_cents bigint default null
) returns void language plpgsql security definer set search_path = public as $$
declare p products;
begin
  select * into p from products where id = p_product;
  if p.id is null then raise exception 'produto nao encontrado' using errcode = 'P0002'; end if;
  if not can_price(p.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_cost_cents, 0) < 0 or coalesce(p_current_price_cents, 0) < 0 then
    raise exception 'valores nao podem ser negativos' using errcode = '22023';
  end if;

  update products
     set cost_cents = coalesce(p_cost_cents, cost_cents),
         current_price_cents = coalesce(p_current_price_cents, current_price_cents)
   where id = p_product;

  perform log_audit(p.tenant_id, 'price.product_update', 'products', p.id::text,
                    jsonb_build_object('cost_cents', p.cost_cents, 'current_price_cents', p.current_price_cents),
                    jsonb_build_object('cost_cents', coalesce(p_cost_cents, p.cost_cents),
                                       'current_price_cents', coalesce(p_current_price_cents, p.current_price_cents)));
end $$;

do $$
declare v_beta uuid;
begin
  select id into v_beta from tenants where name = 'Distribuidora Beta';
  if v_beta is null then return; end if;

  insert into counterparties (tenant_id, cnpj, name, role, regime)
  select v_beta, x.cnpj, x.name, 'customer'::party_role, x.regime::regime_kind
  from (values
    ('11222333000181', 'Mercado São Jorge Ltda', 'presumido'),
    ('22333444000172', 'Padaria Bom Dia ME', 'simples'),
    ('33444555000163', 'Rede Atacadão Real SA', 'real')
  ) as x(cnpj, name, regime)
  where not exists (select 1 from counterparties c where c.tenant_id = v_beta and c.cnpj = x.cnpj);

  insert into products (tenant_id, sku, name, ncm, cost_cents, current_price_cents, source, active)
  select v_beta, x.sku, x.name, x.ncm, x.cost, x.price, 'seed', true
  from (values
    ('SKU-001', 'Arroz tipo 1 5kg',        '10063021', 18500, 24900),
    ('SKU-002', 'Feijão carioca 1kg',      '07133399',  6200,  8990),
    ('SKU-003', 'Óleo de soja 900ml',      '15079011',  5400,  7490),
    ('SKU-004', 'Açúcar refinado 1kg',     '17019900',  3800,  5290),
    ('SKU-005', 'Café torrado 500g',       '09012100', 14200, 18900),
    ('SKU-006', 'Leite UHT integral 1L',   '04012010',  4200,  5490),
    ('SKU-007', 'Farinha de trigo 1kg',    '11010010',  3100,  4290),
    ('SKU-008', 'Macarrão espaguete 500g', '19021900',  2900,  3990),
    ('SKU-009', 'Detergente 500ml',        '34022000',  2400,  3490),
    ('SKU-010', 'Papel higiênico 12un',    '48181000', 16800, 21900)
  ) as x(sku, name, ncm, cost, price)
  where not exists (select 1 from products p where p.tenant_id = v_beta and p.sku = x.sku);
end $$;

revoke execute on function can_price(uuid) from public, anon;
revoke execute on function price_credit_factor(regime_kind) from public, anon;
revoke execute on function price_scenario_compute(uuid) from public, anon;
revoke execute on function price_scenario_create(uuid, text, numeric, int, uuid, numeric) from public, anon;
revoke execute on function price_scenario_detail(uuid) from public, anon;
revoke execute on function approve_price_scenario(uuid) from public, anon;
revoke execute on function update_product_price(uuid, bigint, bigint) from public, anon;

grant execute on function can_price(uuid) to authenticated;
grant execute on function price_credit_factor(regime_kind) to authenticated;
grant execute on function price_scenario_compute(uuid) to authenticated;
grant execute on function price_scenario_create(uuid, text, numeric, int, uuid, numeric) to authenticated;
grant execute on function price_scenario_detail(uuid) to authenticated;
grant execute on function approve_price_scenario(uuid) to authenticated;
grant execute on function update_product_price(uuid, bigint, bigint) to authenticated;