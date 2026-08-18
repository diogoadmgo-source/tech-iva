-- Migration 20260818032125 (0154_apuracao_debitos_documento) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- APURAÇÃO — modelo no nível do DOCUMENTO, como a API realmente entrega
-- Fonte: documentação oficial "Apuração de débitos do CBS"
-- ============================================================================
-- Eu tinha modelado a apuração como árvore de contas (o que a TELA mostra).
-- A API entrega outra coisa, e melhor: DÉBITO POR DOCUMENTO FISCAL, com chave
-- do DF-e, CNPJ do emitente e do adquirente, e — o campo que importa para caixa —
-- valorCBSNaoExtinto: o que ainda falta pagar naquele documento.
--
-- Isso permite conciliação NOTA A NOTA contra nossas invoices, não só de totais.
-- É a diferença entre dizer "há divergência de R$ 3 mil" e dizer "a nota 4512
-- para o cliente X está com CBS de R$ 300 na Receita e R$ 200 aqui".
--
-- DOIS ACHADOS que eu não tinha modelado:
--
-- 1. creditosPISCOFINS — crédito de PIS/COFINS pode EXTINGUIR débito de CBS.
--    É mecanismo de transição: empresa com estoque de crédito de PIS/COFINS
--    paga menos CBS em dinheiro. Muda a projeção de caixa de quem tem esse saldo,
--    e ninguém está contando isso ao contribuinte.
--
-- 2. debitosExtemporaneos — débitos de períodos ANTERIORES que chegam no mês
--    corrente. Caixa que aparece do passado, fora da competência, e que a
--    projeção mensal ignoraria.

create type apuracao_grupo as enum ('corrente','ajuste','extemporaneo');
create type debito_situacao as enum ('aguardando_processamento','nao_extinto','extinto_parcial','extinto_total','cancelado');

create table rtc_debito (
  id                  bigserial primary key,
  apuracao_id         uuid not null references rtc_apuracao(id) on delete cascade,
  tenant_id           uuid not null references tenants(id) on delete cascade,
  grupo               apuracao_grupo not null,
  competencia         date not null,              -- de dataApuracao (AAAAMM)
  modelo_dfe          text,
  numero_dfe          text,
  chave_dfe           text,
  emitido_em          timestamptz,
  autorizado_em       timestamptz,
  registrado_em       timestamptz,
  ni_emitente         text,
  ni_adquirente       text,
  cbs_total_cents     bigint not null default 0,
  cbs_extinto_cents   bigint not null default 0,
  cbs_nao_extinto_cents bigint not null default 0,
  situacao            debito_situacao,
  -- formas de extinção, consolidadas por origem
  ext_credito_cbs_cents      bigint not null default 0,
  ext_credito_piscofins_cents bigint not null default 0,
  ext_pagamento_cents        bigint not null default 0,
  ext_prescricao_cents       bigint not null default 0,
  tipos_pagamento     text[] not null default '{}',  -- split | adquirente | contribuinte | responsavel
  payload             jsonb
);
create index rtc_debito_ap on rtc_debito (apuracao_id, grupo);
create index rtc_debito_chave on rtc_debito (tenant_id, chave_dfe);
create index rtc_debito_aberto on rtc_debito (tenant_id, competencia)
  where cbs_nao_extinto_cents > 0;

alter table rtc_debito enable row level security;
create policy rtc_debito_select on rtc_debito for select to authenticated using (in_scope(tenant_id));
grant select on rtc_debito to authenticated;
grant all on rtc_debito to service_role;

-- CONCILIAÇÃO NOTA A NOTA: o que a Receita diz de cada documento versus o nosso
-- cálculo. É aqui que o produto deixa de dar um total e passa a apontar o dedo.
create or replace function conciliacao_documentos(p_tenant uuid, p_competencia date,
                                                  p_so_divergentes boolean default true)
returns table (chave_dfe text, numero_dfe text, contraparte text,
               receita_cents bigint, nosso_cents bigint, diferenca_cents bigint,
               nao_extinto_cents bigint, situacao debito_situacao, grupo apuracao_grupo)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select d.chave_dfe, d.numero_dfe,
         coalesce(c.name, d.ni_adquirente) as contraparte,
         d.cbs_total_cents,
         coalesce(i.cbs_cents, 0),
         d.cbs_total_cents - coalesce(i.cbs_cents, 0),
         d.cbs_nao_extinto_cents,
         d.situacao, d.grupo
  from rtc_debito d
  left join invoices i on i.tenant_id = d.tenant_id and i.access_key = d.chave_dfe
  left join counterparties c on c.id = i.counterparty_id
  where d.tenant_id = p_tenant
    and d.competencia = date_trunc('month', p_competencia)::date
    and (not p_so_divergentes
         or i.id is null                                     -- nota que a Receita tem e nós não
         or d.cbs_total_cents <> coalesce(i.cbs_cents, 0))   -- valor divergente
  order by abs(d.cbs_total_cents - coalesce(i.cbs_cents,0)) desc;
end $$;
grant execute on function conciliacao_documentos(uuid, date, boolean) to authenticated;

-- Resumo por forma de extinção. Responde: quanto do imposto foi pago em DINHEIRO
-- e quanto foi abatido com crédito — inclusive crédito de PIS/COFINS.
create or replace function extincao_resumo(p_tenant uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'competencia', date_trunc('month',p_competencia)::date,
    'debito_total_cents', coalesce(sum(cbs_total_cents),0),
    'extinto_cents', coalesce(sum(cbs_extinto_cents),0),
    'ainda_devido_cents', coalesce(sum(cbs_nao_extinto_cents),0),
    'por_credito_cbs_cents', coalesce(sum(ext_credito_cbs_cents),0),
    'por_credito_piscofins_cents', coalesce(sum(ext_credito_piscofins_cents),0),
    'por_pagamento_cents', coalesce(sum(ext_pagamento_cents),0),
    'por_prescricao_cents', coalesce(sum(ext_prescricao_cents),0),
    'documentos', count(*),
    'documentos_em_aberto', count(*) filter (where cbs_nao_extinto_cents > 0),
    'extemporaneos_cents', coalesce(sum(cbs_total_cents) filter (where grupo='extemporaneo'),0)
  ) into v
  from rtc_debito
  where tenant_id = p_tenant and competencia = date_trunc('month', p_competencia)::date;
  return v;
end $$;
grant execute on function extincao_resumo(uuid, date) to authenticated;

-- Tíquete de download é de USO ÚNICO (documentação oficial). Marcamos o consumo
-- para nunca tentarmos duas vezes e desperdiçar uma das 8 chamadas diárias.
alter table rtc_apuracao add column if not exists download_em timestamptz;
