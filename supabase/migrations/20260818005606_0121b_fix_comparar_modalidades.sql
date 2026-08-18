-- Migration 20260818005606 (0121b_fix_comparar_modalidades) — exportada de supabase_migrations.schema_migrations
-- correção: as CTEs não sobrevivem entre instruções; a pior semana precisa
-- estar na mesma consulta
create or replace function comparar_modalidades(p_tenant uuid, p_horizon_days int default 120)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_hoje date := current_date; v_fim date; v_weekly bigint; v_res jsonb := '[]'::jsonb;
        m modalidade_recolhimento; v_g30 bigint; v_g60 bigint; v_g90 bigint;
        v_sem date; v_saldo bigint;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  v_fim := v_hoje + p_horizon_days;

  select coalesce(sum(ibs_cents + cbs_cents),0) / 13 into v_weekly
  from invoices where tenant_id = p_tenant and direction='out' and issued_at >= v_hoje - 90;

  foreach m in array array['apuracao','rad','split']::modalidade_recolhimento[] loop
    with fluxo as (
      select data_saida_imposto(m, i.issued_at, coalesce(r.expected_date, r.due_date)) d,
             -(i.ibs_cents + i.cbs_cents) v
      from receivables r join invoices i on i.id=r.invoice_id
      where r.tenant_id=p_tenant and r.paid_at is null and (i.ibs_cents+i.cbs_cents)>0
      union all
      select case when m='apuracao'
                  then (date_trunc('month', g) + interval '1 month' + interval '19 days')::date
                  else g::date end,
             case when m='apuracao' then -(v_weekly*4.33)::bigint else -v_weekly end
      from generate_series(
             case when m='apuracao' then date_trunc('month', v_hoje)::date
                  else date_trunc('week', v_hoje)::date + 7 end,
             v_fim,
             case when m='apuracao' then interval '1 month' else interval '7 days' end) g
      where v_weekly > 0
      union all
      select (issued_at + 150)::date, credit_cents
      from invoices where tenant_id=p_tenant and direction='in' and credit_cents>0
    ),
    janela as (select d, v from fluxo where d between v_hoje and v_fim),
    totais as (
      select coalesce(sum(v) filter (where d <= v_hoje+30),0) g30,
             coalesce(sum(v) filter (where d <= v_hoje+60),0) g60,
             coalesce(sum(v) filter (where d <= v_hoje+90),0) g90
      from janela),
    pior as (
      select date_trunc('week', d)::date sem, sum(v) s
      from janela group by 1 order by 2 asc limit 1)
    select t.g30, t.g60, t.g90, p.sem, p.s
      into v_g30, v_g60, v_g90, v_sem, v_saldo
    from totais t left join pior p on true;

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'modalidade', m,
      'rotulo', case m when 'apuracao' then 'Apuração mensal (padrão em 2027)'
                       when 'rad' then 'Recolhimento pelo Adquirente (opcional)'
                       else 'Split Payment (sem data definida)' end,
      'gap_30_cents', coalesce(v_g30,0), 'gap_60_cents', coalesce(v_g60,0),
      'gap_90_cents', coalesce(v_g90,0),
      'pior_semana', case when v_sem is null then null
                          else jsonb_build_object('semana', to_char(v_sem,'YYYY-MM-DD'),
                                                  'saldo_cents', v_saldo) end));
  end loop;

  return jsonb_build_object(
    'atual', tenant_modalidade(p_tenant),
    'horizonte_dias', p_horizon_days,
    'cenarios', v_res,
    'observacao', 'O split payment não começa em janeiro de 2027 (CGIBS, 12/08/2026). '||
                  'Quando vier, será gradual e opcional na primeira etapa, restrito a B2B. '||
                  'O RAD é alternativa opcional para 2027. A modalidade muda QUANDO o imposto '||
                  'deixa o seu caixa, não QUANTO você paga.');
end $$;
grant execute on function comparar_modalidades(uuid,int) to authenticated;
