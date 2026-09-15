-- 0226_apuracao_recurso_versao.sql — ESPELHO da migration a aplicar no banco.
--
-- ATENÇÃO, antes de aplicar: o corpo de `rtc_apuracao_solicitar` abaixo foi
-- REESCRITO a partir do comportamento documentado (a função não tinha espelho
-- em db/migrations). Confira contra o que está no banco antes de aplicar:
--   select pg_get_functiondef(oid) from pg_proc
--    where proname = 'rtc_apuracao_solicitar' and pronamespace = 'public'::regnamespace;
-- A de `rtc_quota_take` veio da 0092 e é fiel; só o limite e o texto mudaram.

-- Uma linha de rtc_apuracao passa a saber de qual recurso e de qual versão da
-- API ela veio. Sem isto, débitos e créditos da v2 ficam indistinguíveis na
-- mesma tabela, e o leitor não sabe qual formato aplicar.
alter table public.rtc_apuracao
  add column if not exists recurso text not null default 'debitos',
  add column if not exists api_versao smallint not null default 1,
  add column if not exists tea_segundos int;

comment on column public.rtc_apuracao.tea_segundos is
  'Tempo estimado de atendimento devolvido no 201 da abertura v2. Usado para so consultar a situacao depois que ele passar.';

alter table public.rtc_apuracao
  drop constraint if exists rtc_apuracao_recurso_ck;
alter table public.rtc_apuracao
  add constraint rtc_apuracao_recurso_ck
  check (recurso in ('debitos','creditos','pagamentos','recolhimentos'));

-- ───────────────────── cota: o limite deixa de ser fixo ─────────────────────
-- A v1 abre 2 solicitações por dia; a v2 abre 4. O limite passa a poder vir de
-- quem chama; sem ele, continua valendo o do tipo (2 e 8), como antes.
--
-- A versão de 3 parâmetros é REMOVIDA: com as duas coexistindo, chamada com os
-- 3 argumentos originais fica ambígua e falha em runtime (mesmo motivo da 0201).
drop function if exists public.rtc_quota_take(text, text, text);

create or replace function public.rtc_quota_take(
  p_cnpj text, p_kind text, p_origem text default 'manual', p_limite int default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8);
        v_padrao int := case p_kind when 'solicitacao' then 2 when 'download' then 8 else 0 end;
        v_limite_receita int;
        v_limite_efetivo int;
        v_atual int;
begin
  if v_padrao = 0 then raise exception 'tipo de cota invalido: %', p_kind; end if;
  if p_origem not in ('manual','automatico') then raise exception 'origem invalida: %', p_origem; end if;

  -- Limite de quem chama (a v2 manda 4); sem ele, o do tipo. O download já era
  -- 8, que é o mesmo da v2 — por isso nada muda para ele.
  v_limite_receita := coalesce(p_limite, v_padrao);
  if v_limite_receita < 1 then raise exception 'limite de cota invalido: %', p_limite; end if;

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
        -- o número sai interpolado: dizer "as duas" mentiria quando o limite é 4
        else 'A Receita Federal limita '||v_limite_receita||' consultas por dia por CNPJ, e todas já foram usadas hoje. Tente novamente amanhã.'
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

revoke all on function public.rtc_quota_take(text, text, text, int) from public, anon, authenticated;
grant execute on function public.rtc_quota_take(text, text, text, int) to service_role;

-- ──────────────── abertura: marca o recurso e a versão na linha ─────────────
-- Mesmo motivo do drop acima: a versão de 3 parâmetros sai de cena para a
-- chamada com 3 argumentos não ficar ambígua.
drop function if exists public.rtc_apuracao_solicitar(uuid, date, text);

create or replace function public.rtc_apuracao_solicitar(
  p_tenant uuid,
  p_competencia date,
  p_origem text default 'manual',
  p_recurso text default 'debitos',
  p_api_versao smallint default 1)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cnpj text;
        v_cota jsonb;
        v_ref  text;
        v_id   uuid;
        v_comp date := date_trunc('month', p_competencia)::date;
begin
  select cnpj into v_cnpj from tenants where id = p_tenant;
  if v_cnpj is null or btrim(v_cnpj) = '' then
    raise exception 'empresa sem CNPJ cadastrado';
  end if;

  if p_recurso not in ('debitos','creditos','pagamentos','recolhimentos') then
    raise exception 'recurso invalido: %', p_recurso;
  end if;

  -- A cota é debitada ANTES da chamada externa, de propósito: melhor recusar
  -- aqui com mensagem nossa do que tomar 429 da Receita e o usuário achar que o
  -- sistema quebrou. Limite: 2 na v1, 4 na v2 (o endpoint de abertura é o único
  -- limitado; situação e download não entram nesta conta).
  v_cota := rtc_quota_take(v_cnpj, 'solicitacao', p_origem,
                           case when p_api_versao >= 2 then 4 else 2 end);
  if not coalesce((v_cota->>'permitido')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', v_cota->>'motivo', 'cota', v_cota);
  end if;

  -- 24 bytes aleatórios em hex = 48 caracteres. É o segredo que autentica o
  -- webhook de retorno; quem confere o formato do outro lado é refValido().
  v_ref := encode(gen_random_bytes(24), 'hex');

  insert into rtc_apuracao (tenant_id, competencia, status, webhook_ref, recurso, api_versao)
  values (p_tenant, v_comp, 'solicitada', v_ref, p_recurso, p_api_versao)
  returning id into v_id;

  perform log_audit(
    p_tenant, 'apuracao.solicitar', 'rtc_apuracao', v_id::text, null,
    jsonb_build_object('competencia', v_comp, 'origem', p_origem, 'cota', v_cota,
                       'recurso', p_recurso, 'api_versao', p_api_versao));

  return jsonb_build_object('ok', true, 'id', v_id, 'webhook_ref', v_ref,
                            'cnpj8', left(regexp_replace(v_cnpj,'\D','','g'),8),
                            'cota', v_cota);
end $$;

revoke all on function public.rtc_apuracao_solicitar(uuid, date, text, text, smallint) from public, anon, authenticated;
grant execute on function public.rtc_apuracao_solicitar(uuid, date, text, text, smallint) to service_role;

-- Pós-voo (passo 2 do plano): esperado `recurso` com default 'debitos' e
-- `api_versao` com default 1.
-- select column_name, column_default from information_schema.columns
--  where table_schema='public' and table_name='rtc_apuracao'
--    and column_name in ('recurso','api_versao');
