-- 0146_apuracao_estrutura_real.sql — ESPELHO da migration aplicada no banco pelo Diogo.
-- Motivo: a Apuração Assistida REAL da Receita (observada no portal, GDB ago/2026) não é
-- "quatro totais". Tem situação em estágios, DOIS totais com natureza C/D, seis visões
-- (abas) e uma ÁRVORE DE CONTAS hierárquica cuja ordem de apresentação importa.
-- Guardar só totais perdia o número que é a tese do produto:
-- "CRÉDITOS ACUMULADOS PASSÍVEIS DE APROPRIAÇÃO R$ 40.007,93 C".
-- Não reaplicar em banco existente; serve para reconstruir do zero, na ordem.

do $$ begin
  create type public.apuracao_situacao as enum ('em_andamento','periodo_ajuste','concluida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.apuracao_natureza as enum ('credor','devedor','neutro');
exception when duplicate_object then null; end $$;

-- A natureza (C/D) é dado próprio, não sinal: a Receita apresenta "8.253,73 C".
alter table public.rtc_apuracao
  add column if not exists situacao               public.apuracao_situacao,
  add column if not exists natureza_resultado     public.apuracao_natureza,
  add column if not exists resultado_cents        bigint,
  add column if not exists saldo_atualizado_cents bigint,
  add column if not exists natureza_saldo         public.apuracao_natureza,
  add column if not exists intencao_ressarcimento boolean not null default false;

-- Uma linha por conta/subconta de cada visão. `ordem` preserva a sequência em que
-- a Receita apresenta (o contador reconhece pela ordem, não pelo nome isolado).
create table if not exists public.rtc_apuracao_conta (
  id           bigserial primary key,
  apuracao_id  uuid not null references public.rtc_apuracao(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  visao        text not null,          -- resultado | saldo_atualizado | eventos | em_processamento | outras_informacoes | nao_aproveitados
  caminho      text not null,          -- caminho hierárquico da conta
  conta        text not null,          -- nome exibido, igual ao do portal
  nivel        smallint not null default 0,
  ordem        smallint not null default 0,
  valor_cents  bigint not null default 0,
  natureza     public.apuracao_natureza not null default 'neutro',
  tem_detalhe  boolean not null default false,
  payload      jsonb
);

create index if not exists rtc_ap_conta_ap on public.rtc_apuracao_conta (apuracao_id, visao, ordem);
create index if not exists rtc_ap_conta_tenant on public.rtc_apuracao_conta (tenant_id);

grant select on public.rtc_apuracao_conta to authenticated;
grant all on public.rtc_apuracao_conta to service_role;
alter table public.rtc_apuracao_conta enable row level security;

drop policy if exists rtc_ap_conta_select on public.rtc_apuracao_conta;
create policy rtc_ap_conta_select on public.rtc_apuracao_conta
  for select to authenticated using (in_scope(tenant_id));

-- Totais + visões agrupadas por aba, prontas para a tela consumir.
create or replace function public.apuracao_detalhe(p_tenant uuid, p_competencia date)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
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

revoke all on function public.apuracao_detalhe(uuid, date) from public;
grant execute on function public.apuracao_detalhe(uuid, date) to authenticated;

-- Equivalente ao "Minhas Apurações da CBS" do portal.
create or replace function public.apuracoes_lista(p_tenant uuid, p_limite integer default 24)
returns table(competencia date, situacao apuracao_situacao, natureza_resultado apuracao_natureza,
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

revoke all on function public.apuracoes_lista(uuid, integer) from public;
grant execute on function public.apuracoes_lista(uuid, integer) to authenticated;

-- Gravação vinda do worker (service_role): apuração + árvore de contas na ordem recebida.
create or replace function public.rtc_apuracao_upsert(p_tenant uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
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

revoke all on function public.rtc_apuracao_upsert(uuid, jsonb) from public;
grant execute on function public.rtc_apuracao_upsert(uuid, jsonb) to service_role;
