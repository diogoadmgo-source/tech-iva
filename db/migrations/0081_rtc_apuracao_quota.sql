-- 0081_rtc_apuracao_quota.sql — ESPELHO da migration já aplicada no banco pelo time.
-- Apuração assistida da Receita + controle de cota da API RTC.
-- Limites da Receita (não nossos): 2 solicitações/dia/CNPJ (429 acima disso),
-- 8 downloads/dia, arquivo válido por 24h, token por 1h.

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
create or replace function public.rtc_quota_status(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_cnpj text; v_c8 text; v_usadas int; v_downloads int;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select cnpj into v_cnpj from tenants where id = p_tenant;
  v_c8 := left(regexp_replace(coalesce(v_cnpj,''),'\D','','g'), 8);

  select coalesce(solicitacoes,0), coalesce(downloads,0) into v_usadas, v_downloads
    from rtc_api_quota where cnpj8=v_c8 and dia=current_date;
  v_usadas := coalesce(v_usadas,0); v_downloads := coalesce(v_downloads,0);

  return jsonb_build_object(
    'usadas', v_usadas, 'limite', 2, 'restantes', greatest(2 - v_usadas, 0),
    'pode_manual', v_usadas < 2, 'downloads_usados', v_downloads,
    'mensagem', case
      when v_usadas = 0 then 'A Receita permite 2 consultas por dia. Nenhuma usada hoje.'
      when v_usadas = 1 then 'A Receita permite 2 consultas por dia. Você está na 2ª e última de hoje.'
      else 'As 2 consultas diárias permitidas pela Receita já foram usadas hoje. A cota reinicia amanhã.'
    end,
    'reinicia_em', (current_date + 1)::text);
end $$;

revoke all on function public.rtc_quota_status(uuid) from public;
grant execute on function public.rtc_quota_status(uuid) to authenticated;

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
