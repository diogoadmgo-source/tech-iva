-- Migration 20260818005534 (0121_comparar_modalidades) — exportada de supabase_migrations.schema_migrations
-- A empresa vai TER QUE ESCOLHER a modalidade em 2027. Comparar o efeito no caixa
-- é exatamente a decisão que ela precisa tomar — e ninguém no mercado mostra isso.
-- Simulação pura: não grava eventos, não altera nada.
create or replace function comparar_modalidades(p_tenant uuid, p_horizon_days int default 120)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_hoje date := current_date; v_fim date; v_weekly bigint; v_res jsonb := '[]'::jsonb;
        m modalidade_recolhimento; v_g30 bigint; v_g60 bigint; v_g90 bigint; v_pior jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  v_fim := v_hoje + p_horizon_days;

  select coalesce(sum(ibs_cents + cbs_cents),0) / 13 into v_weekly
  from invoices where tenant_id = p_tenant and direction='out' and issued_at >= v_hoje - 90;

  foreach m in array array['apuracao','rad','split']::modalidade_recolhimento[] loop
    with saidas as (
      -- notas já emitidas
      select data_saida_imposto(m, i.issued_at, coalesce(r.expected_date, r.due_date)) d,
             (i.ibs_cents + i.cbs_cents) v
      from receivables r join invoices i on i.id=r.invoice_id
      where r.tenant_id=p_tenant and r.paid_at is null and (i.ibs_cents+i.cbs_cents)>0
      union all
      -- vendas futuras pelo run-rate, no ritmo que a modalidade impõe
      select case when m='apuracao'
                  then (date_trunc('month', g) + interval '1 month' + interval '19 days')::date
                  else g::date end,
             case when m='apuracao' then (v_weekly*4.33)::bigint else v_weekly end
      from generate_series(
             case when m='apuracao' then date_trunc('month', v_hoje)::date
                  else date_trunc('week', v_hoje)::date + 7 end,
             v_fim,
             case when m='apuracao' then interval '1 month' else interval '7 days' end) g
      where v_weekly > 0
    ),
    entradas as (
      select (issued_at + 150)::date d, credit_cents v
      from invoices where tenant_id=p_tenant and direction='in' and credit_cents>0
    ),
    fluxo as (
      select d, -v v from saidas where d between v_hoje and v_fim
      union all
      select d, v from entradas where d between v_hoje and v_fim
    )
    select coalesce(sum(v) filter (where d <= v_hoje+30),0),
           coalesce(sum(v) filter (where d <= v_hoje+60),0),
           coalesce(sum(v) filter (where d <= v_hoje+90),0)
      into v_g30, v_g60, v_g90 from fluxo;

    select coalesce(jsonb_build_object('semana', to_char(sem,'YYYY-MM-DD'), 'saldo_cents', s), 'null'::jsonb)
      into v_pior
    from (select date_trunc('week', d)::date sem, sum(v) s
          from (select d, -v v from saidas where d between v_hoje and v_fim
                union all select d, v from entradas where d between v_hoje and v_fim) f
          group by 1 order by 2 asc limit 1) w;

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'modalidade', m,
      'rotulo', case m when 'apuracao' then 'Apuração mensal (padrão em 2027)'
                       when 'rad' then 'Recolhimento pelo Adquirente (opcional)'
                       else 'Split Payment (sem data definida)' end,
      'gap_30_cents', v_g30, 'gap_60_cents', v_g60, 'gap_90_cents', v_g90,
      'pior_semana', v_pior));
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

-- avisos atualizados com o fato novo
insert into platform_notices (key, scope, severity, title, body) values
('split_adiado', 'caixa', 'warning',
 'O split payment não começa em janeiro de 2027',
 'O Comitê Gestor do IBS informou em 12/08/2026 que o split payment não estará disponível em janeiro de 2027 — '||
 'as instituições financeiras pediram prazo adicional. Ele virá depois, de forma gradual, e na primeira etapa '||
 'será OPCIONAL e restrito a operações entre empresas. Para 2027 existe o RAD (Recolhimento pelo Adquirente), '||
 'também opcional. Por isso a projeção assume, por padrão, a APURAÇÃO MENSAL: o imposto sai no vencimento da '||
 'guia, não a cada recebimento. Você pode comparar as três modalidades nesta tela.'),
('conformidade_2026', 'validador', 'info',
 'Corrigir inconsistências até o fim do exercício evita sanções',
 'O CGIBS instituiu o Programa Nacional de Conformidade Tributária. Os contribuintes que aderirem e corrigirem '||
 'inconsistências nas notas fiscais até o encerramento do exercício não ficam sujeitos às sanções previstas para '||
 'essas ocorrências. Neste momento a prioridade declarada dos fiscos é orientar e permitir a regularização — '||
 'é a melhor janela para acertar a parametrização do seu emissor.')
on conflict (key) do nothing;
