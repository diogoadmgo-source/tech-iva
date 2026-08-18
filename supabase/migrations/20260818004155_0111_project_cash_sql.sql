-- Migration 20260818004155 (0111_project_cash_sql) — exportada de supabase_migrations.schema_migrations
-- Projeção de caixa inteiramente em SQL. Antes o worker lia recebíveis pela API
-- REST (cortada em 1000 linhas), montava os eventos em memória no Node e inseria
-- de 500 em 500. Com 75 mil recebíveis isso era lento E errado.
-- Agora: uma transação, tudo set-based. O worker só chama e reporta.
create or replace function project_cash_sql(p_tenant uuid, p_horizon_days int default 120)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_rule uuid; v_hoje date := current_date; v_fim date; v_weekly bigint;
        v_tax bigint; v_credit bigint; v_prov bigint; v_total bigint; v_gap30 bigint;
begin
  v_fim := v_hoje + p_horizon_days;
  select id into v_rule from rule_versions where is_current limit 1;

  -- substituição atômica do horizonte (passado é histórico e não se toca)
  delete from tax_cash_events where tenant_id = p_tenant and event_date >= v_hoje;

  -- 1. imposto que sai no recebimento das notas já emitidas
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_invoice_id, confidence, rule_version_id)
  select p_tenant, coalesce(r.expected_date, r.due_date), 'tax_out',
         i.ibs_cents + i.cbs_cents, i.id, coalesce(r.confidence,0.6), v_rule
  from receivables r join invoices i on i.id = r.invoice_id
  where r.tenant_id = p_tenant and r.paid_at is null
    and coalesce(r.expected_date, r.due_date) between v_hoje and v_fim
    and (i.ibs_cents + i.cbs_cents) > 0;
  get diagnostics v_tax = row_count;

  -- 2. run-rate: a empresa continua vendendo. Sem isto o horizonte fica vazio e
  --    a tela mostra folga onde há aperto.
  select coalesce(sum(ibs_cents + cbs_cents),0) / 13 into v_weekly
  from invoices where tenant_id = p_tenant and direction = 'out'
    and issued_at >= v_hoje - 90;

  if v_weekly > 0 then
    insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, confidence, rule_version_id)
    select p_tenant, d::date, 'tax_out', v_weekly,
           greatest(0.45, 0.85 - (d::date - v_hoje)/300.0), v_rule
    from generate_series(date_trunc('week', v_hoje)::date + 7, v_fim, interval '7 days') d;
  end if;

  -- 3. crédito das compras voltando (150 dias)
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_invoice_id, confidence, rule_version_id)
  select p_tenant, issued_at + 150, 'credit_in', credit_cents, id, 0.7, v_rule
  from invoices
  where tenant_id = p_tenant and direction = 'in' and credit_cents > 0
    and issued_at + 150 between v_hoje and v_fim;
  get diagnostics v_credit = row_count;

  -- 4. provisão mensal sugerida (não é movimento de caixa; fica fora do gap)
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, confidence, rule_version_id)
  select p_tenant,
         greatest(date_trunc('month', event_date)::date, v_hoje),
         'provision', sum(amount_cents)/4, 0.8, v_rule
  from tax_cash_events
  where tenant_id = p_tenant and kind = 'tax_out' and event_date >= v_hoje
  group by date_trunc('month', event_date);
  get diagnostics v_prov = row_count;

  select count(*) into v_total from tax_cash_events where tenant_id = p_tenant and event_date >= v_hoje;

  select coalesce(sum(case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents else 0 end),0)
    into v_gap30
  from tax_cash_events
  where tenant_id = p_tenant and kind <> 'provision' and event_date between v_hoje and v_hoje + 30;

  return jsonb_build_object('events', v_total, 'tax_out_events', v_tax, 'credit_events', v_credit,
                            'provision_events', v_prov, 'weekly_run_rate_cents', v_weekly,
                            'gap_30_cents', v_gap30);
end $$;
revoke execute on function project_cash_sql(uuid,int) from public, anon, authenticated;
grant execute on function project_cash_sql(uuid,int) to service_role;

-- índices que o teste de carga mostrou serem necessários
create index if not exists invoices_tenant_dir_issued on invoices (tenant_id, direction, issued_at);
create index if not exists receivables_open on receivables (tenant_id, expected_date, due_date) where paid_at is null;
create index if not exists items_tenant_pending on invoice_items (tenant_id) where calc_memory is null;
