-- 0080_rtc_integration.sql — ESPELHO da migration aplicada no banco pelo Diogo.
-- Conteúdo único, tudo junto como no banco: rtc_class_trib + rtc_api_quota + rtc_apuracao
-- + validate_class_trib + rtc_quota_take + apuracao_divergencia.
-- ATENÇÃO à ordem: rtc_quota_take é REESCRITA depois pela 0092 (parâmetro p_origem) e
-- rtc_quota_status nasce lá — não duplique aqui, senão a versão antiga vence.
-- Não reaplicar em banco existente; serve para reconstruir do zero, na ordem.

create table if not exists public.rtc_class_trib (
  cst              text not null,
  cclasstrib       text not null,
  descricao        text,
  efeito           text,                 -- tributado | reduzido | isento | imune | diferido | monofasico
  reducao_pct      numeric(6,3) not null default 0,
  permite_credito  boolean not null default true,
  base_legal       text,
  vigencia_inicio  date,
  vigencia_fim     date,
  fonte            text,
  atualizado_em    timestamptz not null default now(),
  primary key (cst, cclasstrib)
);

grant select on public.rtc_class_trib to authenticated;
grant all on public.rtc_class_trib to service_role;

alter table public.rtc_class_trib enable row level security;

drop policy if exists rtc_ct_select on public.rtc_class_trib;
create policy rtc_ct_select on public.rtc_class_trib
  for select to authenticated using (true);

-- Valida a combinação e devolve efeito, redução, direito a crédito e base legal.
-- Quando inválida, devolve o motivo e as combinações válidas daquele CST.
create or replace function public.validate_class_trib(
  p_cst text, p_cclasstrib text, p_data date default current_date
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v rtc_class_trib;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  select * into v from rtc_class_trib
   where cst = p_cst and cclasstrib = p_cclasstrib
     and (vigencia_inicio is null or vigencia_inicio <= p_data)
     and (vigencia_fim is null or vigencia_fim >= p_data);

  if v.cst is null then
    return jsonb_build_object('valida', false,
      'motivo', 'Combinação CST '||p_cst||' × cClassTrib '||p_cclasstrib||' não encontrada ou fora de vigência',
      'sugestoes', (select coalesce(jsonb_agg(jsonb_build_object('cclasstrib', c.cclasstrib, 'descricao', c.descricao)), '[]'::jsonb)
                    from rtc_class_trib c where c.cst = p_cst
                      and (c.vigencia_fim is null or c.vigencia_fim >= p_data) limit 10));
  end if;

  return jsonb_build_object('valida', true, 'efeito', v.efeito, 'reducao_pct', v.reducao_pct,
                            'permite_credito', v.permite_credito, 'base_legal', v.base_legal,
                            'descricao', v.descricao);
end $$;

revoke all on function public.validate_class_trib(text, text, date) from public;
grant execute on function public.validate_class_trib(text, text, date) to authenticated;

-- Carga a partir dos dados abertos da Receita (só service_role).
create or replace function public.rtc_class_trib_upsert(p jsonb)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare n int := 0; r jsonb;
begin
  for r in select * from jsonb_array_elements(p) loop
    insert into rtc_class_trib (cst, cclasstrib, descricao, efeito, reducao_pct,
                                permite_credito, base_legal, vigencia_inicio, vigencia_fim, atualizado_em)
    values (r->>'cst', r->>'cclasstrib', r->>'descricao', r->>'efeito',
            (r->>'reducao_pct')::numeric, (r->>'permite_credito')::boolean, r->>'base_legal',
            (r->>'vigencia_inicio')::date, (r->>'vigencia_fim')::date, now())
    on conflict (cst, cclasstrib) do update set
      descricao=excluded.descricao, efeito=excluded.efeito, reducao_pct=excluded.reducao_pct,
      permite_credito=excluded.permite_credito, base_legal=excluded.base_legal,
      vigencia_inicio=excluded.vigencia_inicio, vigencia_fim=excluded.vigencia_fim,
      atualizado_em=now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.rtc_class_trib_upsert(jsonb) from public;
grant execute on function public.rtc_class_trib_upsert(jsonb) to service_role;

-- ---------------------------------------------- cota da Receita e apuração assistida
create table if not exists public.rtc_api_quota (
  cnpj8         text not null,
  dia           date not null default current_date,
  solicitacoes  integer not null default 0,
  downloads     integer not null default 0,
  ultimo_erro   text,
  primary key (cnpj8, dia)
);

grant select on public.rtc_api_quota to authenticated;
grant all on public.rtc_api_quota to service_role;
alter table public.rtc_api_quota enable row level security;

drop policy if exists rtc_quota_select on public.rtc_api_quota;
create policy rtc_quota_select on public.rtc_api_quota
  for select to authenticated using (is_platform());

create table if not exists public.rtc_apuracao (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  competencia      date not null,
  status           text not null default 'solicitada',  -- solicitada | disponivel | erro
  tiquete          text,
  webhook_ref      text,
  debitos_cents    bigint,
  creditos_cents   bigint,
  pagamentos_cents bigint,
  saldo_cents      bigint,
  payload          jsonb,
  solicitado_em    timestamptz not null default now(),
  recebido_em      timestamptz,
  erro             text
);

create index if not exists rtc_apuracao_tenant_comp_idx
  on public.rtc_apuracao (tenant_id, competencia desc);

grant select on public.rtc_apuracao to authenticated;
grant all on public.rtc_apuracao to service_role;
alter table public.rtc_apuracao enable row level security;

drop policy if exists rtc_apuracao_select on public.rtc_apuracao;
create policy rtc_apuracao_select on public.rtc_apuracao
  for select to authenticated using (in_scope(tenant_id));

-- Consome a cota. A rotina automática nunca gasta a última solicitação do dia.
create or replace function public.rtc_quota_take(p_cnpj text, p_kind text, p_origem text default 'manual')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8);
        v_limite_receita int := case p_kind when 'solicitacao' then 2 when 'download' then 8 else 0 end;
        v_limite_efetivo int;
        v_atual int;
begin
  if v_limite_receita = 0 then raise exception 'tipo de cota invalido: %', p_kind; end if;
  if p_origem not in ('manual','automatico') then raise exception 'origem invalida: %', p_origem; end if;

  v_limite_efetivo := case
    when p_kind = 'solicitacao' and p_origem = 'automatico' then v_limite_receita - 1
    else v_limite_receita end;

  insert into rtc_api_quota (cnpj8, dia) values (v_c8, current_date)
  on conflict (cnpj8, dia) do nothing;

  select case when p_kind='solicitacao' then solicitacoes else downloads end
    into v_atual from rtc_api_quota where cnpj8=v_c8 and dia=current_date for update;

  if v_atual >= v_limite_efetivo then
    return jsonb_build_object(
      'permitido', false, 'usado', v_atual, 'limite', v_limite_receita,
      'limite_efetivo', v_limite_efetivo, 'origem', p_origem,
      'motivo', case
        when p_origem = 'automatico'
          then 'A consulta automática do dia já foi feita. A consulta restante fica reservada para você pedir quando quiser.'
        else 'A Receita Federal limita '||v_limite_receita||' consultas por dia por CNPJ, e as duas já foram usadas hoje. Tente novamente amanhã.'
      end);
  end if;

  if p_kind='solicitacao' then
    update rtc_api_quota set solicitacoes = solicitacoes + 1 where cnpj8=v_c8 and dia=current_date;
  else
    update rtc_api_quota set downloads = downloads + 1 where cnpj8=v_c8 and dia=current_date;
  end if;

  return jsonb_build_object('permitido', true, 'usado', v_atual + 1,
                            'limite', v_limite_receita, 'restantes', v_limite_receita - (v_atual + 1),
                            'origem', p_origem);
end $$;

revoke all on function public.rtc_quota_take(text, text, text) from public;
grant execute on function public.rtc_quota_take(text, text, text) to service_role;

-- Cota restante do dia para a interface (mostra ANTES do clique).
-- Compara o que NÓS calculamos com o que a RECEITA apurou na competência.
create or replace function public.apuracao_divergencia(p_tenant uuid, p_competencia date)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_receita rtc_apuracao; v_nosso bigint;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;

  select * into v_receita from rtc_apuracao
   where tenant_id=p_tenant and competencia=date_trunc('month',p_competencia)::date
     and status='disponivel' order by recebido_em desc limit 1;

  select coalesce(sum(i.cbs_cents),0) into v_nosso
    from invoices i
   where i.tenant_id=p_tenant and i.direction='out'
     and date_trunc('month', i.issued_at) = date_trunc('month', p_competencia);

  if v_receita.id is null then
    return jsonb_build_object('disponivel', false, 'nosso_debito_cents', v_nosso,
                              'mensagem', 'Apuração da Receita ainda não consultada para esta competência');
  end if;

  return jsonb_build_object(
    'disponivel', true,
    'competencia', v_receita.competencia,
    'receita_debito_cents', v_receita.debitos_cents,
    'nosso_debito_cents', v_nosso,
    'diferenca_cents', coalesce(v_receita.debitos_cents,0) - v_nosso,
    'divergente', abs(coalesce(v_receita.debitos_cents,0) - v_nosso) > 100,
    'recebido_em', v_receita.recebido_em);
end $$;

revoke all on function public.apuracao_divergencia(uuid, date) from public;
grant execute on function public.apuracao_divergencia(uuid, date) to authenticated;

-- enqueue_job passa a aceitar: cnpj_sync, sync_rtc_tables, fetch_apuracao, validate_xml.
-- (definição completa mantida na migration original aplicada no banco)
