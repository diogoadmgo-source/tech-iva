-- =============================================================================
-- 0019_seed_dev_operation.sql   ⚠️  NÃO RODAR EM PRODUÇÃO  ⚠️
-- =============================================================================
-- Espelho do dado de demonstração aplicado manualmente na Distribuidora Beta.
-- Somente DADOS: nenhuma função, tabela, política ou grant é tocado.
-- Requer 0006_seed_dev.sql aplicado (tenant "Distribuidora Beta" existente).
-- Volumes-alvo: 26 contrapartes (18 clientes / 8 fornecedores, 4 'desconhecido'),
-- ~574 notas em 12 meses, ~1.049 itens, ~334 recebíveis (30/45/60, parte paga),
-- vendas ~R$ 16,1 mi/12m, compras ~55%, 128 eventos em tax_cash_events (120 dias),
-- 3 alertas abertos. Determinístico via setseed().
-- =============================================================================

do $$
declare
  v_tenant uuid;
  v_cp uuid; v_inv uuid;
  v_regimes regime_kind[] := array['real','presumido','simples','simples_hibrido','mei',
                                  'real','presumido','simples','desconhecido']::regime_kind[];
  i int; j int; n int;
  v_dir invoice_direction; v_date date; v_total bigint; v_credit bigint;
  v_weekly_run bigint;
begin
  select id into v_tenant from tenants where name = 'Distribuidora Beta';
  if v_tenant is null then raise exception 'seed 0006 nao aplicado'; end if;

  perform setseed(0.42);

  -- limpeza idempotente do dado de demonstração deste tenant ------------------
  delete from tax_cash_events where tenant_id = v_tenant;
  delete from receivables      where tenant_id = v_tenant;
  delete from invoice_items    where tenant_id = v_tenant;
  delete from invoices         where tenant_id = v_tenant;
  delete from alerts           where tenant_id = v_tenant;
  delete from counterparties   where tenant_id = v_tenant;

  -- 26 contrapartes: 18 clientes + 8 fornecedores ----------------------------
  for i in 1..26 loop
    insert into counterparties (tenant_id, cnpj, name, role, regime, regime_source,
                               credit_transfer_pct, regime_checked_at)
    values (v_tenant,
            lpad((10000000000000 + i * 7717)::text, 14, '0'),
            case when i <= 18 then 'Cliente Demo ' || lpad(i::text,2,'0')
                 else 'Fornecedor Demo ' || lpad((i-18)::text,2,'0') end,
            case when i <= 18 then 'customer' else 'supplier' end::party_role,
            case when i in (5, 11, 20, 24) then 'desconhecido'
                 else v_regimes[1 + (i % array_length(v_regimes,1))] end,
            case when i in (5, 11, 20, 24) then 'unknown' else 'sefaz' end,
            case when i in (5, 11, 20, 24) then null else 60 + (i % 5) * 10 end,
            case when i in (5, 11, 20, 24) then null else now() - (i || ' days')::interval end);
  end loop;

  -- ~574 notas / ~1.049 itens / ~334 recebíveis em 12 meses -------------------
  for v_cp in select id from counterparties where tenant_id = v_tenant loop
    n := 18 + floor(random() * 8)::int;                  -- 18..25 notas por parte
    for j in 1..n loop
      select role into strict v_dir from (
        select case when c.role = 'customer' then 'out' else 'in' end::invoice_direction as role
        from counterparties c where c.id = v_cp) s;
      v_date  := current_date - (floor(random() * 365))::int;
      v_total := case when v_dir = 'out'
                      then (60000 + floor(random() * 450000))::bigint * 100
                      else (35000 + floor(random() * 240000))::bigint * 100 end;
      v_credit := (v_total * 0.18)::bigint;

      insert into invoices (tenant_id, counterparty_id, direction, number, issued_at,
                            total_cents, tax_cents, credit_cents, status)
      values (v_tenant, v_cp, v_dir, 'DEMO-' || substr(v_cp::text,1,4) || '-' || j,
              v_date, v_total, (v_total * 0.115)::bigint, v_credit, 'authorized')
      returning id into v_inv;

      -- 1 a 3 itens por nota
      for i in 1..(1 + floor(random() * 2)::int) loop
        insert into invoice_items (tenant_id, invoice_id, description, quantity,
                                   unit_price_cents, total_cents, cfop, ncm)
        values (v_tenant, v_inv, 'Item demo ' || i, 1 + floor(random() * 20),
                (v_total / 3)::bigint, (v_total / 3)::bigint, '5102', '85443000');
      end loop;

      -- recebíveis só para saídas: prazos 30/45/60, parte já paga
      if v_dir = 'out' and random() < 0.62 then
        insert into receivables (tenant_id, invoice_id, counterparty_id, due_date,
                                 amount_cents, paid_at, status)
        values (v_tenant, v_inv, v_cp,
                v_date + (array[30,45,60])[1 + floor(random() * 3)::int],
                v_total,
                case when v_date < current_date - 70 and random() < 0.7
                     then v_date + 40 else null end,
                case when v_date < current_date - 70 and random() < 0.7
                     then 'paid' else 'open' end);
      end if;
    end loop;
  end loop;

  -- run-rate semanal de vendas (base da projeção futura) ----------------------
  select coalesce(sum(total_cents),0) / 52 into v_weekly_run
    from invoices where tenant_id = v_tenant and direction = 'out'
     and issued_at >= current_date - 365;

  -- 128 eventos cobrindo 120 dias -------------------------------------------
  -- (a) tax_out dos recebíveis a vencer
  insert into tax_cash_events (tenant_id, kind, event_date, amount_cents, confidence, ref_invoice_id)
  select v_tenant, 'tax_out', r.due_date + 10, (r.amount_cents * 0.115)::bigint, 0.9, r.invoice_id
    from receivables r
   where r.tenant_id = v_tenant and r.due_date between current_date and current_date + 120;

  -- (b) tax_out da PROJEÇÃO de vendas futuras por run-rate semanal
  --     sem isto o imposto futuro fica subestimado e o T1 mostra folga onde há aperto
  insert into tax_cash_events (tenant_id, kind, event_date, amount_cents, confidence)
  select v_tenant, 'tax_out', d::date, (v_weekly_run * 0.115)::bigint, 0.6
    from generate_series(current_date + 7, current_date + 120, interval '7 days') d;

  -- (c) credit_in com retorno em 150–180 dias
  insert into tax_cash_events (tenant_id, kind, event_date, amount_cents, confidence)
  select v_tenant, 'credit_in', d::date,
         (v_weekly_run * 0.082)::bigint, 0.7
    from generate_series(current_date + 5, current_date + 120, interval '10 days') d;

  -- (d) provisão mensal
  insert into tax_cash_events (tenant_id, kind, event_date, amount_cents, confidence)
  select v_tenant, 'provision', date_trunc('month', d)::date + 19,
         (v_weekly_run * 4 * 0.02)::bigint, 0.95
    from generate_series(current_date, current_date + 120, interval '1 month') d;

  -- 3 alertas abertos --------------------------------------------------------
  insert into alerts (tenant_id, kind, severity, title, payload) values
    (v_tenant, 'cash.gap', 'critical',
     'Buraco de caixa crítico nos próximos 30 dias', '{"horizon_days":30}'::jsonb),
    (v_tenant, 'regime.window', 'warning',
     'Janela de opção do Simples híbrido se aproxima', '{"days_left":45}'::jsonb),
    (v_tenant, 'chain.unknown_regime', 'warning',
     '4 contrapartes sem regime classificado', '{"count":4}'::jsonb);

  perform refresh_cash_timeline();
end $$;
