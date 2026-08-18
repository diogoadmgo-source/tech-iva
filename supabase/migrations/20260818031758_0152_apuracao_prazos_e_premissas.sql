-- Migration 20260818031758 (0152_apuracao_prazos_e_premissas) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- CORREÇÃO DE PREMISSA + PRAZOS OFICIAIS DA APURAÇÃO
-- Fonte: Manual RTC, versão I, 13/01/2026 (Receita Federal)
-- ============================================================================
-- ERRO MEU, encontrado agora: eu fixei o vencimento da guia no DIA 20 do mês
-- seguinte, por analogia com tributos atuais. O manual mostra que isso é
-- impossível: a apuração de um mês só é CONCLUÍDA no dia 26 do mês seguinte.
--
--   Apuração "em andamento":     do dia 01 ao 31 do próprio mês
--   Apuração "período de ajuste": do dia 01 ao 25 do mês seguinte
--   Apuração "concluída":        do dia 26 do mês seguinte em diante
--
-- Não se paga uma apuração antes de ela fechar. O dia 20 estava simplesmente
-- errado, e teria feito a tela mostrar o imposto saindo ANTES de existir.
--
-- A data exata de vencimento em 2027 ainda não está publicada. Em vez de chutar
-- outro número, isto vira PREMISSA EXPLÍCITA, configurável pela plataforma e
-- visível ao usuário — quando a norma sair, muda em um lugar só.

create or replace function premissa_dia_vencimento()
returns int language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select (settings->'premissas'->>'dia_vencimento_apuracao')::int
                   from tenants where kind='platform' limit 1), 30);
$$;
grant execute on function premissa_dia_vencimento() to authenticated;

create or replace function set_premissa_dia_vencimento(p_dia int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_platform() then raise exception 'forbidden'; end if;
  perform require_aal2();
  -- não pode ser antes do dia 26: a apuração só conclui no 26 do mês seguinte
  if p_dia < 26 or p_dia > 31 then
    raise exception 'O vencimento não pode ser antes do dia 26: a apuração do mês anterior só é concluída nessa data (Manual RTC, 13/01/2026).';
  end if;
  update tenants set settings = coalesce(settings,'{}'::jsonb) ||
    jsonb_build_object('premissas', coalesce(settings->'premissas','{}'::jsonb) ||
                       jsonb_build_object('dia_vencimento_apuracao', p_dia))
  where kind='platform';
  perform log_audit((select id from tenants where kind='platform'), 'premissa.vencimento',
                    'tenant', null, null, jsonb_build_object('dia', p_dia));
end $$;
grant execute on function set_premissa_dia_vencimento(int) to authenticated;

-- data de saída corrigida: nunca antes da conclusão da apuração
create or replace function data_saida_imposto(p_modalidade modalidade_recolhimento,
                                              p_emissao date, p_recebimento date)
returns date language sql stable set search_path = public, extensions as $$
  select case p_modalidade
    when 'apuracao' then
      (date_trunc('month', p_emissao) + interval '1 month'
       + make_interval(days => premissa_dia_vencimento() - 1))::date
    else coalesce(p_recebimento, p_emissao)
  end;
$$;
grant execute on function data_saida_imposto(modalidade_recolhimento, date, date) to authenticated;

-- Situação da apuração conforme os prazos oficiais do manual
create or replace function apuracao_situacao_em(p_competencia date, p_ref date default current_date)
returns apuracao_situacao language sql immutable set search_path = public, extensions as $$
  select case
    when p_ref <= (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date
      then 'em_andamento'::apuracao_situacao
    when p_ref <= (date_trunc('month', p_competencia) + interval '1 month' + interval '24 days')::date
      then 'periodo_ajuste'::apuracao_situacao
    else 'concluida'::apuracao_situacao
  end;
$$;
grant execute on function apuracao_situacao_em(date, date) to authenticated;
