-- 0016_regime_simulation.sql — Documento 02 C8 / Documento 03 bloco 3.5 (T4 Regime)
-- Cria:
--   regime_wallet_summary(p_tenant)            -> jsonb  (passo 1 do wizard + premissas sugeridas)
--   run_regime_simulation(p_tenant, p_inputs)  -> uuid    (job regime_sim + grava regime_simulations)
--   share_regime_simulation(p_simulation)      -> void    (alerta no canal/pai + auditoria)
-- Todas security definer, com checagem explícita de papel (in_scope/role_in/is_platform) e audit_log.
-- Não altera RLS existente: regime_simulations continua legível por in_scope e sem INSERT direto do cliente.

-- ---------------------------------------------------------------- helpers

-- Próxima janela de opção de regime: 31/01 do próximo exercício ainda aberto.
create or replace function regime_next_window(p_from date default current_date)
returns date language sql immutable set search_path = public as $$
  select case
    when p_from <= make_date(extract(year from p_from)::int, 1, 31)
      then make_date(extract(year from p_from)::int, 1, 31)
    else make_date(extract(year from p_from)::int + 1, 1, 31)
  end
$$;

-- Alíquota agregada efetiva IBS+CBS por ano da transição (LC 214: teste 2026, ramp 2029-2032, cheio 2033).
create or replace function regime_iva_rate(p_year int)
returns numeric language sql immutable as $$
  select case p_year
    when 2027 then 0.0930
    when 2028 then 0.0930
    when 2029 then 0.1265
    when 2030 then 0.1595
    when 2031 then 0.1925
    when 2032 then 0.2255
    else 0.2650
  end
$$;

-- ---------------------------------------------------------------- passo 1: carteira

create or replace function regime_wallet_summary(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  v_rev bigint;
  v_b2b bigint;
  v_pj_regular bigint;
begin
  if not in_scope(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(sum(i.total_cents), 0),
         coalesce(sum(case when c.id is not null then i.total_cents else 0 end), 0),
         coalesce(sum(case when c.regime in ('presumido','real') then i.total_cents else 0 end), 0)
    into v_rev, v_b2b, v_pj_regular
    from invoices i
    left join counterparties c on c.id = i.counterparty_id
   where i.tenant_id = p_tenant
     and i.direction = 'out'
     and i.issued_at >= (current_date - interval '12 months');

  select jsonb_build_object(
      'revenue_cents', v_rev,
      'b2b_cents', v_b2b,
      'b2c_cents', greatest(v_rev - v_b2b, 0),
      'b2b_share_pct', case when v_rev > 0 then round(v_b2b::numeric * 100 / v_rev, 2) else 0 end,
      'pj_regular_share_pct', case when v_rev > 0 then round(v_pj_regular::numeric * 100 / v_rev, 2) else 0 end,
      'customers_by_regime', coalesce((
        select jsonb_agg(x order by x->>'regime')
          from (select jsonb_build_object('regime', c.regime, 'count', count(*),
                                          'volume_cents', coalesce(sum(i2.total_cents), 0)) as x
                  from counterparties c
                  left join invoices i2 on i2.counterparty_id = c.id and i2.direction = 'out'
                                       and i2.issued_at >= (current_date - interval '12 months')
                 where c.tenant_id = p_tenant and c.role in ('customer','both')
                 group by c.regime) s), '[]'::jsonb),
      'suppliers_by_regime', coalesce((
        select jsonb_agg(x order by x->>'regime')
          from (select jsonb_build_object('regime', c.regime, 'count', count(*),
                                          'volume_cents', coalesce(sum(i3.total_cents), 0)) as x
                  from counterparties c
                  left join invoices i3 on i3.counterparty_id = c.id and i3.direction = 'in'
                                       and i3.issued_at >= (current_date - interval '12 months')
                 where c.tenant_id = p_tenant and c.role in ('supplier','both')
                 group by c.regime) s), '[]'::jsonb),
      'purchases_cents', coalesce((select sum(total_cents) from invoices
                                    where tenant_id = p_tenant and direction = 'in'
                                      and issued_at >= (current_date - interval '12 months')), 0),
      'input_credit_cents', coalesce((select sum(credit_cents) from invoices
                                       where tenant_id = p_tenant and direction = 'in'
                                         and issued_at >= (current_date - interval '12 months')), 0),
      'simples_supplier_share_pct', coalesce((
        select round(sum(case when c.regime in ('simples','simples_hibrido','mei') then i4.total_cents else 0 end)::numeric
                     * 100 / nullif(sum(i4.total_cents), 0), 2)
          from invoices i4 join counterparties c on c.id = i4.counterparty_id
         where i4.tenant_id = p_tenant and i4.direction = 'in'
           and i4.issued_at >= (current_date - interval '12 months')), 0),
      'unknown_regime_count', coalesce((select count(*) from counterparties
                                          where tenant_id = p_tenant and regime = 'desconhecido'), 0),
      'next_window', regime_next_window(),
      'rule_version_id', (select id from rule_versions where is_current limit 1)
    ) into v;

  return v;
end $$;

-- ---------------------------------------------------------------- passo 3: rodar

create or replace function run_regime_simulation(p_tenant uuid, p_inputs jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_job uuid;
  v_sim uuid;
  v_role member_role;
  v_wallet jsonb;
  v_rev numeric;
  v_b2b_share numeric;
  v_margin numeric;
  v_growth numeric;
  v_swap boolean;
  v_base_year int;
  v_years jsonb := '[]'::jsonb;
  y int;
  v_rate numeric;
  v_rev_y numeric;
  v_trad numeric;
  v_hyb numeric;
  v_trad_27 numeric; v_trad_33 numeric;
  v_hyb_27 numeric;  v_hyb_33 numeric;
  v_trad_total numeric := 0;
  v_hyb_total numeric := 0;
  v_credit_trad numeric;
  v_credit_hyb numeric;
  v_delta numeric;
  v_results jsonb;
  v_reco text;
  -- carga do Simples (anexo médio) e parcela não-IVA mantida no híbrido
  c_simples_rate constant numeric := 0.0800;
  c_simples_non_iva constant numeric := 0.0450;   -- IRPJ/CSLL/CPP permanecem no DAS
  c_compliance_trad constant numeric := 1800000;  -- centavos/ano
  c_compliance_hyb  constant numeric := 4800000;
begin
  if not in_scope(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not is_platform() then
    v_role := role_in(p_tenant);
    if v_role is null or v_role not in ('owner','finance','channel_admin') then
      raise exception 'forbidden: papel % nao pode rodar simulacao de regime', coalesce(v_role::text, 'nenhum')
        using errcode = '42501';
    end if;
  end if;

  v_wallet := regime_wallet_summary(p_tenant);
  v_rev := coalesce((p_inputs->>'revenue_cents')::numeric, (v_wallet->>'revenue_cents')::numeric, 0);
  v_b2b_share := least(greatest(coalesce((p_inputs->>'b2b_share_pct')::numeric,
                                         (v_wallet->>'b2b_share_pct')::numeric, 0), 0), 100) / 100;
  v_margin := least(greatest(coalesce((p_inputs->>'margin_pct')::numeric, 20), 0), 90) / 100;
  v_growth := coalesce((p_inputs->>'growth_pct')::numeric, 0) / 100;
  v_swap := coalesce((p_inputs->>'swap_simples_suppliers')::boolean, false);
  v_base_year := coalesce((p_inputs->>'base_year')::int, 2027);

  -- job (fila por tenant garantida por enqueue_job)
  v_job := enqueue_job(p_tenant, 'regime_sim', coalesce(p_inputs, '{}'::jsonb));
  update jobs set status = 'running', started_at = now(), progress = 10 where id = v_job;

  for y in greatest(v_base_year, 2027)..2033 loop
    v_rate := regime_iva_rate(y);
    v_rev_y := v_rev * power(1 + v_growth, y - greatest(v_base_year, 2027));

    -- tradicional: DAS cheio; cliente PJ não aproveita crédito (crédito perdido na cadeia)
    v_trad := v_rev_y * c_simples_rate;
    -- híbrido: parcela não-IVA no DAS + IBS/CBS por fora com crédito de entrada
    v_hyb := v_rev_y * c_simples_non_iva
             + greatest(v_rev_y * v_margin * v_rate
                        - (case when v_swap then v_rev_y * (1 - v_margin) * v_rate * 0.15 else 0 end), 0);

    v_trad_total := v_trad_total + v_trad;
    v_hyb_total := v_hyb_total + v_hyb;
    if y = 2027 then v_trad_27 := v_trad; v_hyb_27 := v_hyb; end if;
    if y = 2033 then v_trad_33 := v_trad; v_hyb_33 := v_hyb; end if;

    v_years := v_years || jsonb_build_object(
      'year', y,
      'iva_rate_pct', round(v_rate * 100, 2),
      'revenue_cents', round(v_rev_y),
      'traditional_cents', round(v_trad),
      'hybrid_cents', round(v_hyb)
    );
  end loop;

  -- crédito transferido a clientes PJ: tradicional transfere ~o crédito presumido; híbrido transfere integral
  v_credit_trad := v_rev * v_b2b_share * regime_iva_rate(2033) * 0.20;
  v_credit_hyb  := v_rev * v_b2b_share * regime_iva_rate(2033);

  v_delta := case when v_trad_total > 0
                  then round((v_trad_total - v_hyb_total) * 100 / v_trad_total, 2) else 0 end;

  v_reco := case
    when v_delta >= 1 then format(
      'Híbrido reduz a carga efetiva em %s%% no período 2027–2033 e preserva %s%% da receita B2B com crédito integral.',
      to_char(v_delta, 'FM990D0'), to_char(round(v_b2b_share * 100, 1), 'FM990D0'))
    when v_delta <= -1 then format(
      'Tradicional continua melhor: o híbrido aumentaria a carga efetiva em %s%% no período.',
      to_char(abs(v_delta), 'FM990D0'))
    else 'Empate técnico (diferença menor que 1%): mantenha o tradicional e revise quando a carteira B2B crescer.'
  end;

  v_results := jsonb_build_object(
    'wallet', v_wallet,
    'years', v_years,
    'traditional', jsonb_build_object(
      'load_2027_cents', round(coalesce(v_trad_27, 0)),
      'load_2033_cents', round(coalesce(v_trad_33, 0)),
      'total_cents', round(v_trad_total),
      'credit_transferred_cents', round(v_credit_trad),
      'compliance_cost_cents', c_compliance_trad),
    'hybrid', jsonb_build_object(
      'load_2027_cents', round(coalesce(v_hyb_27, 0)),
      'load_2033_cents', round(coalesce(v_hyb_33, 0)),
      'total_cents', round(v_hyb_total),
      'credit_transferred_cents', round(v_credit_hyb),
      'compliance_cost_cents', c_compliance_hyb),
    'delta_pct', v_delta,
    'winner', case when v_delta >= 1 then 'hybrid' when v_delta <= -1 then 'traditional' else 'tie' end,
    'b2b_share_pct', round(v_b2b_share * 100, 2),
    'confidence', case when (v_wallet->>'unknown_regime_count')::int > 0 then 'parcial' else 'alta' end
  );

  insert into regime_simulations (tenant_id, inputs, results, recommendation, next_window, rule_version_id)
  values (p_tenant,
          coalesce(p_inputs, '{}'::jsonb) || jsonb_build_object(
            'margin_pct', round(v_margin * 100, 2), 'b2b_share_pct', round(v_b2b_share * 100, 2),
            'growth_pct', round(v_growth * 100, 2), 'swap_simples_suppliers', v_swap,
            'base_year', v_base_year, 'revenue_cents', round(v_rev)),
          v_results, v_reco, regime_next_window(),
          (v_wallet->>'rule_version_id')::uuid)
  returning id into v_sim;

  update jobs set status = 'done', finished_at = now(), progress = 100,
                  result = jsonb_build_object('simulation_id', v_sim)
   where id = v_job;

  perform log_audit(p_tenant, 'regime.simulate', 'regime_simulations', v_sim::text, null,
                    jsonb_build_object('job_id', v_job, 'recommendation', v_reco, 'delta_pct', v_delta));
  return v_sim;
end $$;

-- ---------------------------------------------------------------- compartilhar com o canal

create or replace function share_regime_simulation(p_simulation uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s regime_simulations;
  v_role member_role;
  v_parent uuid;
  v_name text;
begin
  select * into s from regime_simulations where id = p_simulation;
  if s.id is null then raise exception 'simulacao nao encontrada' using errcode = 'P0002'; end if;
  if not in_scope(s.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not is_platform() then
    v_role := role_in(s.tenant_id);
    if v_role is null or v_role not in ('owner','finance','channel_admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select t.parent_id, t.name into v_parent, v_name from tenants t where t.id = s.tenant_id;
  if v_parent is null then
    raise exception 'este tenant nao possui canal/pai para compartilhar' using errcode = '55006';
  end if;

  insert into alerts (tenant_id, kind, severity, title, payload)
  values (v_parent, 'regime.simulation_shared', 'info',
          format('%s compartilhou uma simulação de regime', coalesce(v_name, 'Empresa')),
          jsonb_build_object('simulation_id', s.id, 'company_tenant_id', s.tenant_id,
                             'next_window', s.next_window,
                             'note', coalesce(nullif(p_note, ''), s.recommendation)));

  perform log_audit(s.tenant_id, 'regime.share', 'regime_simulations', s.id::text, null,
                    jsonb_build_object('channel_tenant_id', v_parent));
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function regime_next_window(date) from public, anon;
revoke execute on function regime_iva_rate(int) from public, anon;
revoke execute on function regime_wallet_summary(uuid) from public, anon;
revoke execute on function run_regime_simulation(uuid, jsonb) from public, anon;
revoke execute on function share_regime_simulation(uuid, text) from public, anon;

grant execute on function regime_next_window(date) to authenticated;
grant execute on function regime_iva_rate(int) to authenticated;
grant execute on function regime_wallet_summary(uuid) to authenticated;
grant execute on function run_regime_simulation(uuid, jsonb) to authenticated;
grant execute on function share_regime_simulation(uuid, text) to authenticated;
