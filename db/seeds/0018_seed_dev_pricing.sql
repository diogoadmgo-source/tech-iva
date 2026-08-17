-- 0018_seed_dev_pricing.sql
-- ############################################################################
-- # SEED DEV/STAGING — NÃO RODAR EM PRODUÇÃO.                                #
-- # Dados 100% fictícios (10 produtos e 3 clientes da "Distribuidora Beta")  #
-- # usados apenas para demonstrar as telas T3 (Preço) e T5 (Financiamento).  #
-- # As ofertas de crédito NÃO são semeadas: são geradas em runtime pela RPC   #
-- # credit_generate_offers a partir do caixa do tenant.                      #
-- # Pipeline de produção deve aplicar somente db/migrations/*.sql.            #
-- ############################################################################

-- ---------------------------------------------------------------- seed demo (Distribuidora Beta)

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
    ('SKU-001', 'Arroz tipo 1 5kg',        '10063021', 1850000/100, 2490000/100),
    ('SKU-002', 'Feijão carioca 1kg',      '07133399',  620000/100,  899000/100),
    ('SKU-003', 'Óleo de soja 900ml',      '15079011',  540000/100,  749000/100),
    ('SKU-004', 'Açúcar refinado 1kg',     '17019900',  380000/100,  529000/100),
    ('SKU-005', 'Café torrado 500g',       '09012100', 1420000/100, 1890000/100),
    ('SKU-006', 'Leite UHT integral 1L',   '04012010',  420000/100,  549000/100),
    ('SKU-007', 'Farinha de trigo 1kg',    '11010010',  310000/100,  429000/100),
    ('SKU-008', 'Macarrão espaguete 500g', '19021900',  290000/100,  399000/100),
    ('SKU-009', 'Detergente 500ml',        '34022000',  240000/100,  349000/100),
    ('SKU-010', 'Papel higiênico 12un',    '48181000', 1680000/100, 2190000/100)
  ) as x(sku, name, ncm, cost, price)
  where not exists (select 1 from products p where p.tenant_id = v_beta and p.sku = x.sku);
end $$;

