-- =============================================================================
-- 0019_seed_dev_operation.sql   ⚠️  NÃO RODAR EM PRODUÇÃO  ⚠️
-- =============================================================================
-- Operação de demonstração (somente DADOS: nenhuma função, tabela, política
-- ou grant é tocado). Requer 0006_seed_dev.sql aplicado.
--
-- Tenant alvo: por padrão 'Distribuidora Beta'. Para rodar num tenant
-- descartável, defina antes:
--     set local techiva.seed_tenant = 'Nome do tenant';
--
-- Volumes-alvo: 26 contrapartes (18 clientes / 8 fornecedores, 4 'desconhecido'),
-- ~574 notas em 12 meses, ~1.049 itens, ~334 recebíveis (30/45/60, parte paga),
-- 128+ eventos em tax_cash_events (120 dias), 3 alertas abertos.
-- Impostos separados: IBS 8,8% + CBS 2,7% (total ~11,5%). Determinístico.
--
-- Schema real observado (não alterar sem reconferir):
--   invoices(access_key NOT NULL UNIQUE, ibs_cents, cbs_cents, is_cents, credit_cents)
--   invoice_items(line NOT NULL, qty, base_cents, cst, cclasstrib, ibs/cbs/is_cents)
--   receivables(invoice_id, installment, due_date, paid_at, amount_cents, source, confidence)
-- =============================================================================

do $$
declare
  v_tenant_name text := coalesce(current_setting('techiva.seed_tenant', true), 'Distribuidora Beta');
  v_tenant uuid;
  v_cp uuid; v_inv uuid; v_role party_role;
  v_regimes regime_kind[] := array['real','presumido','simples','simples_hibrido','mei',
                                  'real','presumido','simples']::regime_kind[];
  i int; j int; n int; v_seq bigint := 0;
  v_dir invoice_direction; v_date date;
  v_total bigint; v_ibs bigint; v_cbs bigint; v_credit bigint;
  v_weekly_run bigint;
begin
  select id into v_tenant from tenants where name = v_tenant_name;
  if v_tenant is null then
    raise exception 'tenant % nao encontrado (rode 0006_seed_dev.sql)', v_tenant_name;
  end if;

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
  for v_cp, v_role in select id, role from counterparties where tenant_id = v_tenant loop
    v_dir := case when v_role = 'customer' then 'out' else 'in' end::invoice_direction;
    n := 18 + floor(random() * 8)::int;                  -- 18..25 notas por parte
    for j in 1..n loop
      v_seq  := v_seq + 1;
      v_date := current_date - (floor(random() * 365))::int;
      -- vendas ~R$ 16,1 mi/12m; compras ~55% disso
      v_total := case when v_dir = 'out'
                      then (15000 + floor(random() * 55000))::bigint * 100
                      else (25000 + floor(random() * 56000))::bigint * 100 end;
      v_ibs    := (v_total * 0.088)::bigint;             -- IBS 8,8%
      v_cbs    := (v_total * 0.027)::bigint;             -- CBS 2,7%
      v_credit := (v_total * 0.18)::bigint;

      insert into invoices (tenant_id, counterparty_id, direction, model, access_key,
                            number, series, issued_at, total_cents,
                            ibs_cents, cbs_cents, is_cents, credit_cents, status)
      values (v_tenant, v_cp, v_dir, '55',
              -- chave de acesso fictícia de 44 dígitos, única e determinística
              lpad(replace(v_tenant::text,'-','') , 32, '0') || lpad(v_seq::text, 12, '0'),
              'DEMO-' || lpad(v_seq::text, 6, '0'), '1',
              v_date, v_total, v_ibs, v_cbs, 0, v_credit, 'authorized')
      returning id into v_inv;

      -- 1 ou 2 itens por nota (média ~1,81 → ~1.049 itens)
      for i in 1..(case when random() < 0.81 then 2 else 1 end) loop
        insert into invoice_items (tenant_id, invoice_id, line, description, ncm, cst,
                                   cclasstrib, qty, unit, unit_price_cents, base_cents,
                                   ibs_cents, cbs_cents, is_cents,
                                   credit_eligible, credit_cents)
        values (v_tenant, v_inv, i, 'Item demo ' || i, '85443000', '000',
                '000001', 1 + floor(random() * 20), 'UN',
                (v_total / 3)::bigint, (v_total / 3)::bigint,
                (v_total / 3 * 0.088)::bigint, (v_total / 3 * 0.027)::bigint, 0,
                v_dir = 'in', (v_total / 3 * 0.18)::bigint);
      end loop;

      -- recebíveis só para saídas: prazos 30/45/60, parte já paga
      if v_dir = 'out' and random() < 0.86 then
        insert into receivables (tenant_id, invoice_id, installment, due_date,
                                 expected_date, paid_at, amount_cents, source, confidence)
        values (v_tenant, v_inv, 1,
                v_date + (array[30,45,60])[1 + floor(random() * 3)::int],
                v_date + 45,
                case when v_date < current_date - 70 and random() < 0.7
                     then v_date + 40 else null end,
                v_total, 'demo', 0.9);
      end if;
    end loop;
  end loop;

  -- run-rate semanal de vendas (base da projeção futura) ----------------------
  select coalesce(sum(total_cents),0) / 52 into v_weekly_run
    from invoices where tenant_id = v_tenant and direction = 'out'
     and issued_at >= current_date - 365;

  -- eventos cobrindo 120 dias ------------------------------------------------
  -- (a) tax_out dos recebíveis (IBS + CBS): 60 dias de histórico + 120 à frente,
  --     para o gráfico do T1 ter passado e futuro
  insert into tax_cash_events (tenant_id, kind, event_date, amount_cents, confidence, ref_invoice_id)
  select v_tenant, 'tax_out', r.due_date + 10,
         (coalesce(i.ibs_cents,0) + coalesce(i.cbs_cents,0)), 0.9, r.invoice_id
    from receivables r
    join invoices i on i.id = r.invoice_id
   where r.tenant_id = v_tenant
     and r.due_date between current_date - 60 and current_date + 120;

  -- (b) tax_out da PROJEÇÃO de vendas futuras por run-rate semanal
  --     sem isto o imposto futuro fica subestimado e o T1 mostra folga onde há aperto
  insert into tax_cash_events (tenant_id, kind, event_date, amount_cents, confidence)
  select v_tenant, 'tax_out', d::date, (v_weekly_run * 0.115)::bigint, 0.6
    from generate_series(current_date + 7, current_date + 120, interval '7 days') d;

  -- (c) credit_in com retorno em 150–180 dias
  insert into tax_cash_events (tenant_id, kind, event_date, amount_cents, confidence)
  select v_tenant, 'credit_in', d::date, (v_weekly_run * 0.082)::bigint, 0.7
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
