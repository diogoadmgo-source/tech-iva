-- Migration 20260818031538 (0149_projecao_por_arranjo) — exportada de supabase_migrations.schema_migrations
-- A projeção passa a respeitar a elegibilidade por arranjo.
-- Na modalidade 'split', só as parcelas pagas por um dos SEIS arranjos da Fase 1
-- têm o imposto retido no recebimento. O restante (cartão, dinheiro, outros)
-- continua saindo na apuração mensal, dia 20 do mês seguinte.
-- Sem isto, um cliente que recebe metade em cartão veria o dobro do aperto real.
create or replace function project_cash_sql(p_tenant uuid, p_horizon_days int default 120,
                                            p_modalidade modalidade_recolhimento default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_rule uuid; v_hoje date := current_date; v_fim date; v_weekly bigint;
        v_mod modalidade_recolhimento; v_tax bigint; v_credit bigint; v_prov bigint;
        v_total bigint; v_gap30 bigint; v_split bigint; v_fora bigint;
begin
  v_fim := v_hoje + p_horizon_days;
  v_mod := coalesce(p_modalidade, tenant_modalidade(p_tenant));
  select id into v_rule from rule_versions where is_current limit 1;

  delete from tax_cash_events where tenant_id = p_tenant and event_date >= v_hoje;

  -- 1. imposto das notas emitidas. A data depende da modalidade E, quando a
  --    modalidade é split/rad, da elegibilidade do arranjo de pagamento.
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_invoice_id, confidence, rule_version_id)
  select p_tenant,
         case
           when v_mod = 'apuracao' then data_saida_imposto('apuracao', i.issued_at, null)
           when arranjo_tem_split(r.arranjo) then coalesce(r.expected_date, r.due_date)
           else data_saida_imposto('apuracao', i.issued_at, null)   -- fora da Fase 1
         end,
         'tax_out',
         case
           when v_mod = 'apuracao' or not arranjo_tem_split(r.arranjo)
             then i.ibs_cents + i.cbs_cents
           else split_segregado_cents(r.arranjo, r.valor_pago_cents, r.amount_cents,
                                      i.ibs_cents + i.cbs_cents, null)
         end,
         i.id,
         -- confiança menor quando não sabemos o meio de pagamento
         case when v_mod <> 'apuracao' and r.arranjo = 'desconhecido'
              then least(coalesce(r.confidence,0.6), 0.5) else coalesce(r.confidence,0.6) end,
         v_rule
  from receivables r join invoices i on i.id = r.invoice_id
  where r.tenant_id = p_tenant and r.paid_at is null
    and (i.ibs_cents + i.cbs_cents) > 0
    and (case
           when v_mod = 'apuracao' then data_saida_imposto('apuracao', i.issued_at, null)
           when arranjo_tem_split(r.arranjo) then coalesce(r.expected_date, r.due_date)
           else data_saida_imposto('apuracao', i.issued_at, null)
         end) between v_hoje and v_fim;
  get diagnostics v_tax = row_count;

  -- 2. run-rate das vendas futuras
  select coalesce(sum(ibs_cents + cbs_cents),0) / 13 into v_weekly
  from invoices where tenant_id = p_tenant and direction = 'out' and issued_at >= v_hoje - 90;

  if v_weekly > 0 then
    if v_mod = 'apuracao' then
      insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, confidence, rule_version_id)
      select p_tenant, (date_trunc('month', d) + interval '1 month' + interval '19 days')::date,
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

  select count(*) filter (where arranjo_tem_split(arranjo)),
         count(*) filter (where not arranjo_tem_split(arranjo))
    into v_split, v_fora
  from receivables where tenant_id = p_tenant and paid_at is null;

  return jsonb_build_object('events', v_total, 'modalidade', v_mod, 'tax_out_events', v_tax,
                            'credit_events', v_credit, 'provision_events', v_prov,
                            'weekly_run_rate_cents', v_weekly, 'gap_30_cents', v_gap30,
                            'parcelas_com_split', v_split, 'parcelas_fora_do_split', v_fora);
end $$;
revoke execute on function project_cash_sql(uuid,int,modalidade_recolhimento) from public, anon, authenticated;
grant execute on function project_cash_sql(uuid,int,modalidade_recolhimento) to service_role;

-- avisos novos, vindos dos manuais
insert into platform_notices (key, scope, severity, title, body) values
('split_fase1_arranjos', 'caixa', 'info',
 'O split não alcança todo recebimento',
 'A Fase 1 do Split Payment é B2B opcional e cobre seis meios de pagamento: Boleto, Pix Dinâmico, '||
 'Pix Automático, Pix Estático, TED e TEF. Cartão, dinheiro e demais meios NÃO entram nesta fase. '||
 'Se você recebe parte por cartão, essa parte continua sendo recolhida pela apuração mensal. '||
 'Informe o meio de pagamento das suas parcelas para a projeção ficar precisa.'),
('antecipacao_nao_dispara_split', 'caixa', 'info',
 'Antecipar recebível não adianta o imposto',
 'Pelo Manual de Operações do Split Payment (seção 6.1.1), a antecipação de recebíveis não caracteriza '||
 'liquidação financeira. Isso significa que, ao antecipar, o dinheiro entra no seu caixa hoje, mas o '||
 'imposto continua saindo apenas na data de liquidação original. É uma alavanca legítima de capital de giro.')
on conflict (key) do nothing;
