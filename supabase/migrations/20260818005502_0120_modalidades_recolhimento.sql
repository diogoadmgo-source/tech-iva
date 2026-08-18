-- Migration 20260818005502 (0120_modalidades_recolhimento) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- MODALIDADES DE RECOLHIMENTO — correção de premissa (18/08/2026)
-- ============================================================================
-- FATO NOVO (CGIBS, 12/08/2026): o SPLIT PAYMENT NÃO começa em janeiro/2027.
-- As instituições financeiras pediram prazo. Quando vier, será gradual e, na
-- primeira etapa, OPCIONAL e restrito a B2B. Para 2027 há o RAD (Recolhimento
-- pelo Adquirente), também opcional.
--
-- CONSEQUÊNCIA PARA NÓS: nosso projetor assumia que o imposto sai no RECEBIMENTO
-- (lógica de split). Isso deixou de ser o padrão. Em 2027, o padrão é a apuração
-- mensal: o imposto sai no VENCIMENTO da guia do mês seguinte, não a cada venda.
-- Manter o padrão antigo superestimaria o aperto e nos faria vender medo em vez
-- de informação — o oposto do que queremos.
--
-- Em vez de simplesmente trocar o padrão, tornamos a modalidade uma PREMISSA
-- comparável. A empresa vai ter que ESCOLHER a modalidade em 2027, e comparar o
-- efeito no caixa é exatamente a decisão que ela precisa tomar.

create type modalidade_recolhimento as enum ('apuracao','rad','split');

create or replace function tenant_modalidade(p_tenant uuid)
returns modalidade_recolhimento language sql stable security definer
set search_path = public, extensions as $$
  select coalesce((select (t.settings->>'modalidade_recolhimento')::modalidade_recolhimento
                   from tenants t where t.id = p_tenant), 'apuracao'::modalidade_recolhimento);
$$;
grant execute on function tenant_modalidade(uuid) to authenticated;

create or replace function set_tenant_modalidade(p_tenant uuid, p_modalidade modalidade_recolhimento)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;
  update tenants set settings = coalesce(settings,'{}'::jsonb) ||
    jsonb_build_object('modalidade_recolhimento', p_modalidade::text) where id = p_tenant;
  perform log_audit(p_tenant,'tenant.modalidade','tenant',p_tenant::text,null,
                    jsonb_build_object('modalidade',p_modalidade));
end $$;
grant execute on function set_tenant_modalidade(uuid, modalidade_recolhimento) to authenticated;

-- Data em que o imposto EFETIVAMENTE sai do caixa, conforme a modalidade:
--   apuracao -> vencimento da guia, dia 20 do mês seguinte ao fato gerador
--   rad      -> o adquirente recolhe; para o FORNECEDOR o efeito é imediato no
--               recebimento (ele recebe líquido), como no split
--   split    -> no recebimento
create or replace function data_saida_imposto(p_modalidade modalidade_recolhimento,
                                              p_emissao date, p_recebimento date)
returns date language sql immutable set search_path = public, extensions as $$
  select case p_modalidade
    when 'apuracao' then (date_trunc('month', p_emissao) + interval '1 month' + interval '19 days')::date
    else coalesce(p_recebimento, p_emissao)
  end;
$$;
grant execute on function data_saida_imposto(modalidade_recolhimento, date, date) to authenticated;

-- Projeção reescrita: a modalidade define QUANDO o imposto sai.
create or replace function project_cash_sql(p_tenant uuid, p_horizon_days int default 120,
                                            p_modalidade modalidade_recolhimento default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
revoke execute on function project_cash_sql(uuid,int,modalidade_recolhimento) from public, anon, authenticated;
grant execute on function project_cash_sql(uuid,int,modalidade_recolhimento) to service_role;
drop function if exists project_cash_sql(uuid,int);
