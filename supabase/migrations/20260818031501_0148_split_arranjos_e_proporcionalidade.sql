-- Migration 20260818031501 (0148_split_arranjos_e_proporcionalidade) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- SPLIT PAYMENT — o que os manuais oficiais mudam no nosso modelo
-- ============================================================================
-- Fontes: Manual de Operações (jun/2026), Manual de Tempos v1.0.0 (jul/2026),
-- OpenAPI da Plataforma Pública v0.0.10, Comunicado Ambiente Beta (26/12/2025).
--
-- ACHADO 1 — O SPLIT NÃO ALCANÇA TODO RECEBIMENTO.
-- A Fase 1 é "B2B Opcional" e cobre SEIS arranjos de pagamento:
--   iniciados pelo Recebedor: Boleto, Pix Dinâmico, Pix Automático
--   iniciados pelo Pagador:   Pix Estático, TED, TEF (book transfer)
-- Cartão de crédito/débito, dinheiro e outros meios NÃO estão na Fase 1.
-- Nosso projetor tratava a modalidade 'split' como se TODO recebimento fosse
-- segregado. Para um cliente que recebe metade em cartão, isso superestimava
-- o aperto pela metade. Agora a elegibilidade é por MEIO DE PAGAMENTO.
--
-- ACHADO 2 — PAGAMENTO PARCIAL SEGREGA PROPORCIONALMENTE, e pagamento a maior
-- (multa/juros) NÃO aumenta o imposto segregado. Fórmula oficial:
--   R = mín( (Vp/Vt) × C ; C ; A )
-- onde Vp = valor pago, Vt = valor original sem acréscimos, C = CBS/IBS de
-- referência, A = CBS/IBS "Em Aberto" (limite quando parte do débito já foi
-- extinta por outro meio).

create type arranjo_pagamento as enum (
  'boleto','pix_dinamico','pix_automatico',      -- iniciados pelo Recebedor
  'pix_estatico','ted','tef',                    -- iniciados pelo Pagador
  'cartao','dinheiro','outro','desconhecido'     -- fora da Fase 1
);

-- Elegibilidade ao split conforme a Fase 1 dos manuais
create or replace function arranjo_tem_split(p arranjo_pagamento)
returns boolean language sql immutable set search_path = public, extensions as $$
  select p in ('boleto','pix_dinamico','pix_automatico','pix_estatico','ted','tef');
$$;
grant execute on function arranjo_tem_split(arranjo_pagamento) to authenticated;

-- Só os arranjos iniciados pelo Recebedor têm cálculo de proporcionalidade
-- (Modelo Super Inteligente). Nos iniciados pelo Pagador, o segregado é o
-- informado, sem ajuste.
create or replace function arranjo_tem_proporcionalidade(p arranjo_pagamento)
returns boolean language sql immutable set search_path = public, extensions as $$
  select p in ('boleto','pix_dinamico','pix_automatico');
$$;
grant execute on function arranjo_tem_proporcionalidade(arranjo_pagamento) to authenticated;

alter table receivables
  add column if not exists arranjo arranjo_pagamento not null default 'desconhecido',
  add column if not exists valor_pago_cents bigint;

comment on column receivables.arranjo is
  'Meio de pagamento. Define se a parcela sofre split (Fase 1 cobre 6 arranjos) e se há proporcionalidade.';

-- Fórmula oficial de proporcionalidade (Manual de Operações, seção 5.2)
create or replace function split_segregado_cents(
  p_arranjo arranjo_pagamento,
  p_valor_pago_cents bigint,
  p_valor_original_cents bigint,
  p_tributo_referencia_cents bigint,
  p_tributo_em_aberto_cents bigint default null)
returns bigint language sql immutable set search_path = public, extensions as $$
  select case
    when not arranjo_tem_split(p_arranjo) then 0
    when coalesce(p_tributo_referencia_cents,0) <= 0 then 0
    when not arranjo_tem_proporcionalidade(p_arranjo)
      -- iniciados pelo Pagador: segrega o informado, sem ajuste
      then least(p_tributo_referencia_cents, coalesce(p_tributo_em_aberto_cents, p_tributo_referencia_cents))
    else least(
      -- (Vp / Vt) × C  — pagamento parcial reduz proporcionalmente
      floor(coalesce(p_valor_pago_cents, p_valor_original_cents)::numeric
            / nullif(p_valor_original_cents,0) * p_tributo_referencia_cents)::bigint,
      -- C — pagamento a maior (multa/juros) NÃO aumenta o segregado
      p_tributo_referencia_cents,
      -- A — limite quando parte do débito já foi extinta
      coalesce(p_tributo_em_aberto_cents, p_tributo_referencia_cents))
  end;
$$;
grant execute on function split_segregado_cents(arranjo_pagamento,bigint,bigint,bigint,bigint) to authenticated;

-- ACHADO 3 (o mais importante para o produto):
-- "a antecipação de recebíveis ou qualquer operação de crédito que tenha por
--  objeto o direito creditório associado a uma transação com split NÃO
--  caracteriza, por si só, Pagamento ou Liquidação Financeira (...) portanto
--  não determina a segregação de CBS/IBS (...) no momento em que os recursos
--  são antecipados ao Recebedor."  (Manual de Operações, 6.1.1)
--
-- Ou seja: ANTECIPAR RECEBÍVEL NÃO ADIANTA O IMPOSTO. O dinheiro entra hoje,
-- o imposto continua saindo só na liquidação original. É uma alavanca de caixa
-- legítima e com base normativa — e ninguém está mostrando isso ao contribuinte.
create or replace function ganho_antecipacao(p_tenant uuid, p_dias int default 90)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'base_legal', 'Manual de Operações do Split Payment, seção 6.1.1',
    'principio', 'Antecipar recebível não caracteriza liquidação financeira: o imposto continua saindo na data original.',
    'parcelas_elegiveis', count(*) filter (where arranjo_tem_split(r.arranjo)),
    'valor_antecipavel_cents', coalesce(sum(r.amount_cents) filter (where arranjo_tem_split(r.arranjo)),0),
    'imposto_que_permanece_no_prazo_cents',
      coalesce(sum(i.ibs_cents + i.cbs_cents) filter (where arranjo_tem_split(r.arranjo)),0),
    'horizonte_dias', p_dias
  ) into v
  from receivables r join invoices i on i.id = r.invoice_id
  where r.tenant_id = p_tenant and r.paid_at is null
    and coalesce(r.expected_date, r.due_date) between current_date and current_date + p_dias;
  return v;
end $$;
grant execute on function ganho_antecipacao(uuid,int) to authenticated;
