-- Migration 20260818030832 (0146_apuracao_estrutura_real) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- APURAÇÃO ASSISTIDA — modelo alinhado à estrutura REAL da Receita
-- ============================================================================
-- Ao obter acesso à apuração real da GDB, ficou claro que nosso rtc_apuracao era
-- simplista demais: guardava quatro totais (débitos, créditos, pagamentos, saldo)
-- enquanto a Receita entrega uma ÁRVORE DE CONTAS em cinco visões distintas.
--
-- Estrutura real observada:
--   situação da apuração: Em andamento -> Período de ajuste -> Concluída
--   dois totais no topo: Resultado da apuração e Saldo atualizado, cada um com
--     natureza C (credor) ou D (devedor)
--   abas: Resultado | Saldo Atualizado | Eventos | Em Processamento |
--         Outras Informações | Não Aproveitados
--   dentro de cada aba, contas hierárquicas com subcontas e valor por conta
--
-- Guardar só os totais jogaria fora justamente o que o contador precisa ver —
-- e o que permite explicar uma divergência. Ex.: na GDB de ago/2026 os débitos
-- são zero (destaque declaratório em 2026), mas há R$ 40.007,93 de créditos
-- acumulados passíveis de apropriação. Um campo "saldo" não conta essa história.

create type apuracao_situacao as enum ('em_andamento','periodo_ajuste','concluida');
create type apuracao_natureza as enum ('credor','devedor','neutro');

alter table rtc_apuracao
  add column if not exists situacao apuracao_situacao,
  add column if not exists natureza_resultado apuracao_natureza,
  add column if not exists resultado_cents bigint,
  add column if not exists saldo_atualizado_cents bigint,
  add column if not exists natureza_saldo apuracao_natureza,
  add column if not exists intencao_ressarcimento boolean not null default false;

-- Árvore de contas: uma linha por conta/subconta de cada visão.
-- Preserva a hierarquia e a ordem em que a Receita apresenta, para a tela poder
-- reproduzir a leitura que o contador já conhece.
create table rtc_apuracao_conta (
  id            bigserial primary key,
  apuracao_id   uuid not null references rtc_apuracao(id) on delete cascade,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  visao         text not null,          -- resultado | saldo_atualizado | eventos |
                                        -- em_processamento | outras_informacoes | nao_aproveitados
  caminho       text not null,          -- 'Créditos de CBS apropriados > Nessa apuração'
  conta         text not null,          -- rótulo da própria conta
  nivel         smallint not null default 0,
  ordem         smallint not null default 0,
  valor_cents   bigint not null default 0,
  natureza      apuracao_natureza not null default 'neutro',
  tem_detalhe   boolean not null default false,
  payload       jsonb
);
create index rtc_ap_conta_ap on rtc_apuracao_conta (apuracao_id, visao, ordem);
create index rtc_ap_conta_tenant on rtc_apuracao_conta (tenant_id);

alter table rtc_apuracao_conta enable row level security;
create policy rtc_ap_conta_select on rtc_apuracao_conta for select to authenticated
  using (in_scope(tenant_id));
grant select on rtc_apuracao_conta to authenticated;
grant all on rtc_apuracao_conta to service_role;

-- Leitura para a tela: devolve a apuração com as contas agrupadas por visão,
-- no formato que a interface consome direto.
create or replace function apuracao_detalhe(p_tenant uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare a rtc_apuracao; v jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;

  select * into a from rtc_apuracao
   where tenant_id = p_tenant and competencia = date_trunc('month', p_competencia)::date
     and status = 'disponivel'
   order by recebido_em desc limit 1;

  if a.id is null then
    return jsonb_build_object('disponivel', false, 'competencia', date_trunc('month',p_competencia)::date);
  end if;

  select jsonb_object_agg(visao, contas) into v
  from (
    select c.visao,
           jsonb_agg(jsonb_build_object(
             'caminho', c.caminho, 'conta', c.conta, 'nivel', c.nivel,
             'valor_cents', c.valor_cents, 'natureza', c.natureza,
             'tem_detalhe', c.tem_detalhe) order by c.ordem) contas
    from rtc_apuracao_conta c
    where c.apuracao_id = a.id
    group by c.visao
  ) t;

  return jsonb_build_object(
    'disponivel', true,
    'competencia', a.competencia,
    'situacao', a.situacao,
    'resultado_cents', a.resultado_cents,
    'natureza_resultado', a.natureza_resultado,
    'saldo_atualizado_cents', a.saldo_atualizado_cents,
    'natureza_saldo', a.natureza_saldo,
    'intencao_ressarcimento', a.intencao_ressarcimento,
    'recebido_em', a.recebido_em,
    'visoes', coalesce(v, '{}'::jsonb));
end $$;
grant execute on function apuracao_detalhe(uuid, date) to authenticated;

-- Lista de competências, como a tela "Minhas Apurações da CBS"
create or replace function apuracoes_lista(p_tenant uuid, p_limite int default 24)
returns table (competencia date, situacao apuracao_situacao, natureza_resultado apuracao_natureza,
               resultado_cents bigint, saldo_atualizado_cents bigint, recebido_em timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select distinct on (a.competencia)
         a.competencia, a.situacao, a.natureza_resultado,
         a.resultado_cents, a.saldo_atualizado_cents, a.recebido_em
  from rtc_apuracao a
  where a.tenant_id = p_tenant and a.status = 'disponivel'
  order by a.competencia desc, a.recebido_em desc
  limit p_limite;
end $$;
grant execute on function apuracoes_lista(uuid,int) to authenticated;

-- Gravação pelo worker que baixa da Receita
create or replace function rtc_apuracao_upsert(p_tenant uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; c jsonb; i int := 0;
begin
  insert into rtc_apuracao (tenant_id, competencia, status, situacao, natureza_resultado,
                            resultado_cents, saldo_atualizado_cents, natureza_saldo,
                            intencao_ressarcimento, payload, recebido_em)
  values (p_tenant, (p_payload->>'competencia')::date, 'disponivel',
          (p_payload->>'situacao')::apuracao_situacao,
          (p_payload->>'natureza_resultado')::apuracao_natureza,
          (p_payload->>'resultado_cents')::bigint,
          (p_payload->>'saldo_atualizado_cents')::bigint,
          (p_payload->>'natureza_saldo')::apuracao_natureza,
          coalesce((p_payload->>'intencao_ressarcimento')::boolean,false),
          p_payload, now())
  returning id into v_id;

  for c in select * from jsonb_array_elements(coalesce(p_payload->'contas','[]'::jsonb)) loop
    i := i + 1;
    insert into rtc_apuracao_conta (apuracao_id, tenant_id, visao, caminho, conta, nivel,
                                    ordem, valor_cents, natureza, tem_detalhe, payload)
    values (v_id, p_tenant, c->>'visao', c->>'caminho', c->>'conta',
            coalesce((c->>'nivel')::smallint,0), i,
            coalesce((c->>'valor_cents')::bigint,0),
            coalesce((c->>'natureza')::apuracao_natureza,'neutro'),
            coalesce((c->>'tem_detalhe')::boolean,false), c);
  end loop;

  return v_id;
end $$;
revoke execute on function rtc_apuracao_upsert(uuid,jsonb) from public, anon, authenticated;
grant execute on function rtc_apuracao_upsert(uuid,jsonb) to service_role;
