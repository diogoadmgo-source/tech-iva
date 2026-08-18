-- 0111_project_cash_sql.sql
-- ESPELHO da migration já aplicada no banco (não reaplicar).
--
-- Correção do bug silencioso nº 2: o worker project_cash lia recebíveis pela
-- API REST sem paginação. O PostgREST corta em 1000 linhas por padrão, então
-- com 75 mil recebíveis a projeção usava 1,3% dos dados — sem erro, com número
-- plausível na tela. O pior tipo de bug.
--
-- Correção: a projeção inteira passa a ser feita em SQL, em UMA transação, sem
-- trafegar linha por linha. Medido: 460 ms com 75 mil recebíveis.

create or replace function public.project_cash_sql(
  p_tenant uuid,
  p_horizon_days int default 120,
  p_modalidade modalidade_recolhimento default null
) returns jsonb language plpgsql security definer
set search_path to 'public','extensions' as $$
declare v_rule uuid; v_hoje date := current_date; v_fim date; v_weekly bigint;
        v_mod modalidade_recolhimento; v_tax bigint; v_credit bigint; v_prov bigint;
        v_total bigint; v_gap30 bigint;
begin
  v_fim := v_hoje + p_horizon_days;
  v_mod := coalesce(p_modalidade, tenant_modalidade(p_tenant));
  select id into v_rule from rule_versions where is_current limit 1;

  delete from tax_cash_events where tenant_id = p_tenant and event_date >= v_hoje;

  -- 1. imposto das notas já emitidas, na data que a MODALIDADE determina
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_invoice_id, confidence, rule_version_id)
  select p_tenant,
         data_saida_imposto(v_mod, i.issued_at, coalesce(r.expected_date, r.due_date)),
         'tax_out', i.ibs_cents + i.cbs_cents, i.id, coalesce(r.confidence,0.6), v_rule
  from receivables r join invoices i on i.id = r.invoice_id
  where r.tenant_id = p_tenant and r.paid_at is null
    and (i.ibs_cents + i.cbs_cents) > 0
    and data_saida_imposto(v_mod, i.issued_at, coalesce(r.expected_date, r.due_date)) between v_hoje and v_fim;
  get diagnostics v_tax = row_count;

  -- 2. run-rate das vendas futuras
  select coalesce(sum(ibs_cents + cbs_cents),0) / 13 into v_weekly
  from invoices where tenant_id = p_tenant and direction = 'out' and issued_at >= v_hoje - 90;

  if v_weekly > 0 then
    if v_mod = 'apuracao' then
      -- na apuração mensal o imposto do mês inteiro sai de uma vez, no dia 20 do
      -- mês seguinte: o caixa sofre um degrau, não um gotejamento
      insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, confidence, rule_version_id)
      select p_tenant,
             (date_trunc('month', d) + interval '1 month' + interval '19 days')::date,
             'tax_out', v_weekly * 4.33,
             greatest(0.45, 0.85 - (d::date - v_hoje)/300.0), v_rule
      from generate_series(date_trunc('month', v_hoje)::date, v_fim, interval '1 month') d
      where (date_trunc('month', d) + interval '1 month' + interval '19 days')::date between v_hoje and v_fim;
    else
      insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, confidence, rule_version_id)
      select p_tenant, d::date, 'tax_out', v_weekly,
             greatest(0.45, 0.85 - (d::date - v_hoje)/300.0), v_rule
      from generate_series(date_trunc('week', v_hoje)::date + 7, v_fim, interval '7 days') d;
    end if;
  end if;

  -- 3. crédito das compras
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_invoice_id, confidence, rule_version_id)
  select p_tenant, issued_at + 150, 'credit_in', credit_cents, id, 0.7, v_rule
  from invoices
  where tenant_id = p_tenant and direction = 'in' and credit_cents > 0
    and issued_at + 150 between v_hoje and v_fim;
  get diagnostics v_credit = row_count;

  -- 4. provisão mensal sugerida (fora do gap)
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, confidence, rule_version_id)
  select p_tenant, greatest(date_trunc('month', event_date)::date, v_hoje), 'provision',
         sum(amount_cents)/4, 0.8, v_rule
  from tax_cash_events
  where tenant_id = p_tenant and kind = 'tax_out' and event_date >= v_hoje
  group by date_trunc('month', event_date);
  get diagnostics v_prov = row_count;

  select count(*) into v_total from tax_cash_events where tenant_id = p_tenant and event_date >= v_hoje;
  select coalesce(sum(case kind when 'tax_out' then -amount_cents when 'credit_in' then amount_cents else 0 end),0)
    into v_gap30
  from tax_cash_events
  where tenant_id = p_tenant and kind <> 'provision' and event_date between v_hoje and v_hoje + 30;

  return jsonb_build_object('events', v_total, 'modalidade', v_mod, 'tax_out_events', v_tax,
                            'credit_events', v_credit, 'provision_events', v_prov,
                            'weekly_run_rate_cents', v_weekly, 'gap_30_cents', v_gap30);
end $$;
