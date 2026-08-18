-- Migration 20260818002340 (0091_rtc_quota_policy_and_notices) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- POLÍTICA DE COTA DA APURAÇÃO + AVISOS DE PLATAFORMA
-- ============================================================================
-- Decisões de produto (18/08/2026):
--  1. Dois caminhos de credencial: o cliente gera no Portal OU nos autoriza como
--     procurador digital. Ambos com instruções claras na tela.
--  2. Das 2 consultas diárias que a Receita permite por CNPJ, 1 é reservada para
--     o usuário pedir na hora. A rotina automática nunca consome a última.
--  3. A Receita ainda não trata cancelamento/devolução na apuração assistida.
--     Avisamos na tela em vez de deixar o cliente descobrir sozinho.

-- ------------------------------------------------------- política de cota
-- Origem da chamada decide quantas pode usar:
--   'automatico' -> pode usar no máximo 1 (deixa a outra livre para o usuário)
--   'manual'     -> pode usar até o limite total (2)
create or replace function rtc_quota_take(p_cnpj text, p_kind text, p_origem text default 'manual')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8);
        v_limite_receita int := case p_kind when 'solicitacao' then 2 when 'download' then 8 else 0 end;
        v_limite_efetivo int;
        v_atual int;
begin
  if v_limite_receita = 0 then raise exception 'tipo de cota invalido: %', p_kind; end if;
  if p_origem not in ('manual','automatico') then raise exception 'origem invalida: %', p_origem; end if;

  -- a rotina automática nunca gasta a última solicitação do dia
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
revoke execute on function rtc_quota_take(text,text,text) from public, anon, authenticated;
grant execute on function rtc_quota_take(text,text,text) to service_role;
drop function if exists rtc_quota_take(text,text);

-- O usuário PRECISA ver onde está antes de clicar. Sem isso ele clica, toma erro
-- da Receita e acha que o sistema quebrou.
create or replace function rtc_quota_status(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_cnpj text; v_c8 text; v_usadas int; v_downloads int;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select cnpj into v_cnpj from tenants where id = p_tenant;
  v_c8 := left(regexp_replace(coalesce(v_cnpj,''),'\D','','g'), 8);

  select coalesce(solicitacoes,0), coalesce(downloads,0) into v_usadas, v_downloads
    from rtc_api_quota where cnpj8=v_c8 and dia=current_date;
  v_usadas := coalesce(v_usadas,0); v_downloads := coalesce(v_downloads,0);

  return jsonb_build_object(
    'usadas', v_usadas,
    'limite', 2,
    'restantes', greatest(2 - v_usadas, 0),
    'pode_manual', v_usadas < 2,
    'downloads_usados', v_downloads,
    'mensagem', case
      when v_usadas = 0 then 'A Receita permite 2 consultas por dia. Nenhuma usada hoje.'
      when v_usadas = 1 then 'A Receita permite 2 consultas por dia. Você está na 2ª e última de hoje.'
      else 'As 2 consultas diárias permitidas pela Receita já foram usadas hoje. A cota reinicia amanhã.'
    end,
    'reinicia_em', (current_date + 1)::text);
end $$;
grant execute on function rtc_quota_status(uuid) to authenticated;

-- ------------------------------------------------------- avisos de plataforma
-- Limitações e mudanças de regra mudam com frequência nesta fase. Em vez de
-- texto fixo no código (que exige deploy), a plataforma edita e a tela lê.
create table platform_notices (
  key         text primary key,
  scope       text not null,               -- rota/tela onde aparece
  severity    text not null default 'info',-- info | warning
  title       text not null,
  body        text not null,
  active      boolean not null default true,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
alter table platform_notices enable row level security;
create policy notices_select on platform_notices for select to authenticated using (active or is_platform());
create policy notices_write  on platform_notices for all to authenticated
  using (is_platform()) with check (is_platform());
grant select on platform_notices to authenticated;
grant all on platform_notices to service_role;

create trigger audit_notices after insert or update or delete on platform_notices
  for each row execute function audit_row();

insert into platform_notices (key, scope, severity, title, body) values
('apuracao_cancelamento', 'apuracao', 'warning',
 'Cancelamentos e devoluções ainda não entram na apuração',
 'A Apuração Assistida da Receita Federal ainda não trata documentos de cancelamento e devolução. '||
 'Isso significa que uma nota cancelada continua contando como débito até que a Receita passe a tratá-la, '||
 'e a nossa projeção de caixa herda a mesma limitação. Estamos acompanhando as próximas versões da plataforma.'),
('apuracao_cota', 'apuracao', 'info',
 'A Receita limita 2 consultas por dia',
 'A API da Apuração Assistida permite 2 solicitações por dia para cada CNPJ. '||
 'Fazemos 1 consulta automática por dia e deixamos a outra reservada para você pedir quando precisar. '||
 'O arquivo enviado pela Receita fica disponível por 24 horas.'),
('apuracao_2026_declaratorio', 'apuracao', 'info',
 'Em 2026 o destaque é declaratório',
 'Durante 2026, CBS e IBS são destacados nos documentos fiscais mas não são somados ao total da operação '||
 'e não há pagamento efetivo. Os valores exibidos aqui servem para você se preparar para 2027, '||
 'quando o sistema definitivo entra em vigor.'),
('calculadora_local', 'simulador', 'info',
 'Cálculo pelo motor oficial, sem enviar seus dados',
 'Usamos a Calculadora de Tributos da Receita Federal executada na nossa própria infraestrutura. '||
 'Conforme o manual da RFB, o componente opera sem coleta de dados, sem telemetria e sem transmissão '||
 'automática de informações: as operações que você simula não são enviadas à Administração Tributária. '||
 'As regras de cálculo se atualizam automaticamente quando a Receita publica alterações.')
on conflict (key) do nothing;

create or replace function notices_for(p_scope text)
returns table (key text, severity text, title text, body text)
language sql stable security definer set search_path = public, extensions as $$
  select n.key, n.severity, n.title, n.body
  from platform_notices n
  where n.active and n.scope = p_scope
  order by case n.severity when 'warning' then 0 else 1 end, n.key;
$$;
grant execute on function notices_for(text) to authenticated;
