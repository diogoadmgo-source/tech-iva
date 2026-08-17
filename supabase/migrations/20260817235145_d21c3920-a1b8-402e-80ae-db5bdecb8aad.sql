do $$
declare
  v_tenant uuid;
  i int;
  v_cost bigint;
  v_ratio numeric;
begin
  select id into v_tenant from tenants where name = 'Distribuidora Beta';
  if v_tenant is null then return; end if;

  for i in 1..50 loop
    v_cost  := (1200 + ((i * 977) % 49300))::bigint;
    v_ratio := 1.08 + ((i * 7) % 51) * 0.01;

    insert into products (tenant_id, sku, name, ncm, cost_cents, current_price_cents, source, active)
    values (v_tenant,
            'DEMO-' || lpad(i::text, 3, '0'),
            'Produto demo ' || lpad(i::text, 3, '0'),
            (array['10063021','07133399','15079011','17019900','09012100',
                   '04012010','11010010','19021900','34022000','48181000'])[1 + (i % 10)],
            v_cost,
            round(v_cost * v_ratio)::bigint,
            'seed', true)
    on conflict (tenant_id, sku) do update
      set cost_cents = excluded.cost_cents,
          current_price_cents = excluded.current_price_cents,
          active = true;
  end loop;
end $$;