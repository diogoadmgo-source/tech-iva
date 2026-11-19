-- 0260_cbs_v2_darf_recolhimentos.sql
--
-- Apuração da CBS, API v2: o que a documentação de 13/11/2026 pede e o banco
-- ainda não tinha.
--
--  1. Cota POR API. A FAQ da Receita: "até 4 chamadas por API, por dia e por
--     credencial", reiniciando à meia-noite. A conta antiga (rtc_api_quota) é
--     uma só por CNPJ e dia, e na v2 deixaria débitos e recolhimentos
--     disputando as mesmas 4. A v1 continua na tabela antiga, sem mudança.
--  2. Aviso do webhook v2. Desde 14/10 ele traz só {tiqueteSolicitacao,
--     situacao}: o link do arquivo é pedido depois, no endpoint de download.
--     A versão anterior de rtc_apuracao_receber_tiquete marcava esse aviso
--     como ERRO ("retorno sem url assinada nem tíquete").
--  3. Onde guardar o que a v2 devolve: débitos (lançamentos por documento),
--     pagamentos e recolhimentos (item a item do DARF) e os DARFs que o
--     aplicativo gerar.
--
-- Nada aqui calcula valor fiscal: as tabelas guardam o que a Receita mandou.
-- Escrita só pelo servidor (service_role); leitura pelo escopo do usuário.
-- O padrão do projeto concede ALL a `authenticated` em objeto novo — por isso
-- cada tabela tem o revoke explícito logo depois do create.

-- ------------------------------------------------------------ 1. cota v2

create table if not exists public.rtc_api_quota_v2 (
  cnpj8        text    not null,
  dia          date    not null,
  recurso      text    not null
    check (recurso in ('debitos','creditos','pagamentos','recolhimentos')),
  solicitacoes integer not null default 0,
  primary key (cnpj8, dia, recurso)
);
alter table public.rtc_api_quota_v2 enable row level security;
revoke all on table public.rtc_api_quota_v2 from public, anon, authenticated;
grant select on table public.rtc_api_quota_v2 to authenticated;
grant all on table public.rtc_api_quota_v2 to service_role;
drop policy if exists rtc_quota_v2_select on public.rtc_api_quota_v2;
create policy rtc_quota_v2_select on public.rtc_api_quota_v2
  for select to authenticated using (is_platform());

-- "Meia-noite" da Receita é a de Brasília, não a do servidor (UTC): das 21h às
-- 24h de Brasília o current_date do banco já é o dia seguinte.
create or replace function public.rtc_dia_receita()
 returns date
 language sql
 stable
 set search_path to 'public', 'extensions'
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public.rtc_quota_take_v2(p_cnpj text, p_recurso text, p_origem text default 'manual')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8);
        v_dia date := rtc_dia_receita();
        v_limite int := 4;
        v_efetivo int;
        v_atual int;
begin
  if p_recurso not in ('debitos','creditos','pagamentos','recolhimentos') then
    raise exception 'recurso invalido: %', p_recurso;
  end if;
  if p_origem not in ('manual','automatico') then raise exception 'origem invalida: %', p_origem; end if;
  -- mesma regra da v1: a rotina automática nunca gasta a última do dia
  v_efetivo := case when p_origem = 'automatico' then v_limite - 1 else v_limite end;

  insert into rtc_api_quota_v2 (cnpj8, dia, recurso) values (v_c8, v_dia, p_recurso)
  on conflict do nothing;
  select solicitacoes into v_atual from rtc_api_quota_v2
   where cnpj8 = v_c8 and dia = v_dia and recurso = p_recurso for update;

  if v_atual >= v_efetivo then
    return jsonb_build_object(
      'permitido', false, 'usado', v_atual, 'limite', v_limite, 'recurso', p_recurso,
      'motivo', case when p_origem = 'automatico'
        then 'A consulta automática do dia já foi feita. A consulta restante fica reservada para você pedir quando quiser.'
        else 'A Receita Federal limita '||v_limite||' consultas de '||p_recurso||' por dia, e todas já foram usadas hoje. A cota reinicia à meia-noite.'
      end);
  end if;

  update rtc_api_quota_v2 set solicitacoes = solicitacoes + 1
   where cnpj8 = v_c8 and dia = v_dia and recurso = p_recurso;
  return jsonb_build_object('permitido', true, 'usado', v_atual + 1, 'limite', v_limite,
                            'restantes', v_limite - (v_atual + 1), 'recurso', p_recurso,
                            'origem', p_origem);
end $function$;

create or replace function public.rtc_quota_estornar_v2(p_cnpj text, p_recurso text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_novo int;
begin
  update rtc_api_quota_v2 set solicitacoes = greatest(solicitacoes - 1, 0)
   where cnpj8 = left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8)
     and dia = rtc_dia_receita() and recurso = p_recurso
  returning solicitacoes into v_novo;
  return jsonb_build_object('ok', true, 'recurso', p_recurso, 'usado', coalesce(v_novo, 0));
end $function$;

-- Lida pela tela: o que resta hoje em cada API.
create or replace function public.rtc_quota_status_v2(p_tenant uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_c8 text; v_out jsonb := '{}'::jsonb; r text; v_usadas int;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select left(regexp_replace(coalesce(cnpj,''),'\D','','g'), 8) into v_c8 from tenants where id = p_tenant;
  foreach r in array array['debitos','creditos','pagamentos','recolhimentos'] loop
    select solicitacoes into v_usadas from rtc_api_quota_v2
     where cnpj8 = v_c8 and dia = rtc_dia_receita() and recurso = r;
    v_usadas := coalesce(v_usadas, 0);
    v_out := v_out || jsonb_build_object(r, jsonb_build_object(
      'usadas', v_usadas, 'limite', 4, 'restantes', greatest(4 - v_usadas, 0),
      'pode_manual', v_usadas < 4));
  end loop;
  return v_out || jsonb_build_object('reinicia_em', (rtc_dia_receita() + 1)::text);
end $function$;

revoke all on function public.rtc_dia_receita() from public, anon;
revoke all on function public.rtc_quota_take_v2(text, text, text) from public, anon, authenticated;
revoke all on function public.rtc_quota_estornar_v2(text, text) from public, anon, authenticated;
revoke all on function public.rtc_quota_status_v2(uuid) from public, anon;
grant execute on function public.rtc_dia_receita() to authenticated, service_role;
grant execute on function public.rtc_quota_take_v2(text, text, text) to service_role;
grant execute on function public.rtc_quota_estornar_v2(text, text) to service_role;
grant execute on function public.rtc_quota_status_v2(uuid) to authenticated, service_role;

-- A abertura passa a debitar a cota da API certa na v2. A v1 segue igual.
create or replace function public.rtc_apuracao_solicitar(p_tenant uuid, p_competencia date, p_origem text default 'manual'::text, p_recurso text default 'debitos'::text, p_api_versao smallint default 1)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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

  -- A cota é debitada ANTES da chamada externa. v1: 2 por dia no CNPJ.
  -- v2: 4 por dia em CADA API (débitos, créditos, pagamentos, recolhimentos).
  if p_api_versao >= 2 then
    v_cota := rtc_quota_take_v2(v_cnpj, p_recurso, p_origem);
  else
    v_cota := rtc_quota_take(v_cnpj, 'solicitacao', p_origem, 2);
  end if;
  if not coalesce((v_cota->>'permitido')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', v_cota->>'motivo', 'cota', v_cota);
  end if;

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
end $function$;

-- ------------------------------------------------- 2. aviso do webhook na v2

create or replace function public.rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb, p_meta jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
DECLARE
  v public.rtc_apuracao;
  v_tiquete  text;
  v_url      text;
  v_situacao text;
  v_log      bigint;
BEGIN
  INSERT INTO public.rtc_webhook_recebido (ref, payload, meta)
  VALUES (p_ref, p_payload, p_meta)
  RETURNING id INTO v_log;

  IF p_meta->>'somente_registrar' = 'true' THEN
    RETURN jsonb_build_object('ok', false, 'registrado', true);
  END IF;

  BEGIN

  SELECT * INTO v
    FROM public.rtc_apuracao
   WHERE webhook_ref = p_ref
     AND status = 'solicitada'
     AND solicitado_em > now() - interval '24 hours'
   FOR UPDATE;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_tiquete  := coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete');
  v_url      := p_payload->>'urlAssinada';
  v_situacao := upper(coalesce(p_payload->>'situacao', ''));

  -- v2 desde 14/10/2026: o aviso de sucesso é {tiqueteSolicitacao, situacao}
  -- sem link. A linha continua 'solicitada' — quem busca o link no endpoint
  -- de download é o aplicativo, logo em seguida. Aviso de erro traz
  -- {codigoErro, mensagemErro}.
  IF v.api_versao >= 2 AND v_url IS NULL AND v_tiquete IS NULL THEN
    UPDATE public.rtc_apuracao
       SET webhook_payload = p_payload,
           tiquete_solicitacao = coalesce(nullif(p_payload->>'tiqueteSolicitacao',''), tiquete_solicitacao),
           webhook_recebido_em = now(),
           webhook_ref = NULL,
           status = CASE WHEN v_situacao = 'CONCLUIDA' THEN 'solicitada' ELSE 'erro' END,
           erro = CASE WHEN v_situacao = 'CONCLUIDA' THEN NULL
                       ELSE left(coalesce(nullif(p_payload->>'mensagemErro',''),
                                          nullif(p_payload->>'codigoErro',''),
                                          'aviso da Receita sem situação concluída (corpo em webhook_payload)'), 400)
                  END
     WHERE id = v.id;

    UPDATE public.rtc_webhook_recebido SET aceito = true, apuracao_id = v.id WHERE id = v_log;
    PERFORM public.log_audit(
      v.tenant_id, 'apuracao.aviso', 'rtc_apuracao', v.id::text, NULL,
      jsonb_build_object('recebido_em', now(), 'formato', 'v2_aviso',
                         'situacao', nullif(v_situacao, '')));
    RETURN jsonb_build_object('ok', true, 'id', v.id, 'aviso_v2', true,
                              'concluida', v_situacao = 'CONCLUIDA');
  END IF;

  UPDATE public.rtc_apuracao
     SET webhook_payload = p_payload,
         tiquete_solicitacao = coalesce(p_payload->>'tiqueteSolicitacao', tiquete_solicitacao),
         tiquete_download = v_tiquete,
         url_assinada = v_url,
         url_assinada_expira_em = nullif(p_payload->>'urlAssinadaExpiraEm','')::timestamptz,
         status = CASE
           WHEN v_url IS NOT NULL OR v_tiquete IS NOT NULL THEN 'tiquete_recebido'
           ELSE 'erro'
         END,
         erro = CASE
           WHEN v_url IS NULL AND v_tiquete IS NULL
             THEN coalesce(
                    nullif(p_payload->>'mensagemErro',''),
                    'retorno sem url assinada nem tiquete (corpo bruto em webhook_payload)')
           ELSE NULL
         END,
         webhook_recebido_em = now(),
         webhook_ref = NULL
   WHERE id = v.id;

  UPDATE public.rtc_webhook_recebido
     SET aceito = true, apuracao_id = v.id
   WHERE id = v_log;

  PERFORM public.log_audit(
    v.tenant_id, 'apuracao.tiquete', 'rtc_apuracao', v.id::text, NULL,
    jsonb_build_object('recebido_em', now(),
                       'formato', CASE WHEN v_url IS NOT NULL THEN 'v2'
                                       WHEN v_tiquete IS NOT NULL THEN 'v1'
                                       ELSE 'erro' END)
  );

  RETURN jsonb_build_object('ok', true, 'id', v.id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.rtc_webhook_recebido SET erro = SQLERRM WHERE id = v_log;
    RETURN jsonb_build_object('ok', false, 'erro', SQLERRM);
  END;
END;
$function$;

-- ------------------------------------------------------ 3. dados da v2

-- Débitos v2. A janela da Receita é INCREMENTAL (inclusões e atualizações dos
-- últimos 8 dias): uma consulta nova não substitui a anterior, ela atualiza.
-- Por isso a chave é o lançamento (pa + documento + origem), não a apuração.
create table if not exists public.rtc_cbs_debito_v2 (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  apuracao_id           uuid references public.rtc_apuracao(id) on delete set null,
  pa                    date not null,
  chave                 text not null,
  origem                integer not null,
  documento             integer not null,
  emissao               timestamptz,
  registro              timestamptz,
  atualizacao           timestamptz,
  apurado_cents         bigint not null default 0,
  excedente_cents       bigint not null default 0,
  inexigivel_cents      bigint not null default 0,
  suspenso_cents        bigint not null default 0,
  pgto_antecipado_cents bigint not null default 0,
  extinto_cents         bigint not null default 0,
  saldo_devedor_cents   bigint not null default 0,
  recebido_em           timestamptz not null default now(),
  unique (tenant_id, pa, chave, origem)
);
create index if not exists rtc_cbs_debito_v2_tenant_pa on public.rtc_cbs_debito_v2 (tenant_id, pa);
create index if not exists rtc_cbs_debito_v2_apuracao on public.rtc_cbs_debito_v2 (apuracao_id);

-- Pagamentos (o que extinguiu débitos da empresa) e recolhimentos (o que ela
-- pagou como adquirente). Mesma forma de arquivo, um registro por item da
-- composição do DARF.
create table if not exists public.rtc_cbs_pagamento (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  apuracao_id      uuid references public.rtc_apuracao(id) on delete set null,
  recurso          text not null check (recurso in ('pagamentos','recolhimentos')),
  data_arrecadacao date not null,
  numero_darf      text not null,
  tipo             integer not null,
  ni_adquirente    text,
  ni_contribuinte  text,
  sequencial       integer not null,
  pa               date not null,
  vencimento       date,
  ni_fornecedor    text,
  chave_dfe        text,
  principal_cents  bigint not null default 0,
  multa_cents      bigint not null default 0,
  juros_cents      bigint not null default 0,
  total_cents      bigint not null default 0,
  recebido_em      timestamptz not null default now(),
  unique (tenant_id, recurso, numero_darf, sequencial)
);
create index if not exists rtc_cbs_pagamento_tenant on public.rtc_cbs_pagamento (tenant_id, recurso, data_arrecadacao desc);
create index if not exists rtc_cbs_pagamento_apuracao on public.rtc_cbs_pagamento (apuracao_id);

-- DARFs gerados pelo aplicativo. Guarda o pedido e a resposta, inclusive as
-- recusas: um DARF é documento oficial, e quem pediu o quê precisa ficar.
create table if not exists public.rtc_cbs_darf (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  tipo                 text not null check (tipo in ('pcont','rad')),
  pa                   text,
  chave_dfe            text,
  opcao_pagamento      text not null check (opcao_pagamento in ('PAGAMENTO_TOTAL','PAGAMENTO_PARCIAL')),
  valor_parcial_cents  bigint,
  pedido               jsonb not null,
  http_status          integer,
  cd_retorno           text not null,
  gerado               boolean not null default false,
  chave_pix            text,
  codigo_barras        text,
  link_pdf             text,
  data_maxima          date,
  principal_cents      bigint,
  multa_cents          bigint,
  juros_cents          bigint,
  total_cents          bigint,
  mensagem             text,
  dados_invalidos      text[] not null default '{}',
  solicitado_por       uuid,
  criado_em            timestamptz not null default now()
);
create index if not exists rtc_cbs_darf_tenant on public.rtc_cbs_darf (tenant_id, criado_em desc);

alter table public.rtc_cbs_debito_v2 enable row level security;
alter table public.rtc_cbs_pagamento enable row level security;
alter table public.rtc_cbs_darf enable row level security;
revoke all on table public.rtc_cbs_debito_v2 from public, anon, authenticated;
revoke all on table public.rtc_cbs_pagamento from public, anon, authenticated;
revoke all on table public.rtc_cbs_darf from public, anon, authenticated;
grant select on table public.rtc_cbs_debito_v2, public.rtc_cbs_pagamento, public.rtc_cbs_darf to authenticated;
grant all on table public.rtc_cbs_debito_v2, public.rtc_cbs_pagamento, public.rtc_cbs_darf to service_role;

drop policy if exists rtc_cbs_debito_v2_select on public.rtc_cbs_debito_v2;
create policy rtc_cbs_debito_v2_select on public.rtc_cbs_debito_v2
  for select to authenticated using (in_scope(tenant_id));
drop policy if exists rtc_cbs_pagamento_select on public.rtc_cbs_pagamento;
create policy rtc_cbs_pagamento_select on public.rtc_cbs_pagamento
  for select to authenticated using (in_scope(tenant_id));
drop policy if exists rtc_cbs_darf_select on public.rtc_cbs_darf;
create policy rtc_cbs_darf_select on public.rtc_cbs_darf
  for select to authenticated using (in_scope(tenant_id));

-- "MM/AAAA" → primeiro dia do mês. Texto fora do formato é erro explícito.
create or replace function public.rtc_pa_data(p text)
 returns date
 language plpgsql
 immutable
 set search_path to 'public', 'extensions'
as $$
begin
  if p !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' then
    raise exception 'periodo de apuracao fora do formato MM/AAAA: %', left(coalesce(p,'(nulo)'), 20);
  end if;
  return to_date('01/' || p, 'DD/MM/YYYY');
end $$;

/*
 * Grava as linhas já lidas pelo servidor (src/lib/rtc-v2/debitos.ts e
 * pagamentos.ts) e fecha a apuração como disponível. Idempotente: repetir com
 * o mesmo arquivo dá o mesmo estado. Linha mais antiga (atualizacao menor)
 * nunca sobrescreve uma mais nova.
 */
create or replace function public.rtc_cbs_v2_ingerir(p_apuracao uuid, p_linhas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v rtc_apuracao; n int := 0; l jsonb;
begin
  select * into v from rtc_apuracao where id = p_apuracao for update;
  if v.id is null then raise exception 'apuracao inexistente'; end if;
  if coalesce(v.api_versao, 1) < 2 then raise exception 'apuracao nao e da v2'; end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then raise exception 'linhas deveriam ser uma lista'; end if;

  if v.recurso = 'debitos' then
    for l in select * from jsonb_array_elements(p_linhas) loop
      insert into rtc_cbs_debito_v2 as d (tenant_id, apuracao_id, pa, chave, origem, documento,
        emissao, registro, atualizacao, apurado_cents, excedente_cents, inexigivel_cents,
        suspenso_cents, pgto_antecipado_cents, extinto_cents, saldo_devedor_cents)
      values (v.tenant_id, v.id, rtc_pa_data(l->>'pa'), l->>'chave', (l->>'origem')::int,
        (l->>'documento')::int, (l->>'emissao')::timestamptz, (l->>'registro')::timestamptz,
        (l->>'atualizacao')::timestamptz, (l->>'apurado_cents')::bigint,
        (l->>'excedente_cents')::bigint, (l->>'inexigivel_cents')::bigint,
        (l->>'suspenso_cents')::bigint, (l->>'pgto_antecipado_cents')::bigint,
        (l->>'extinto_cents')::bigint, (l->>'saldo_devedor_cents')::bigint)
      on conflict (tenant_id, pa, chave, origem) do update set
        apuracao_id = excluded.apuracao_id, documento = excluded.documento,
        emissao = excluded.emissao, registro = excluded.registro, atualizacao = excluded.atualizacao,
        apurado_cents = excluded.apurado_cents, excedente_cents = excluded.excedente_cents,
        inexigivel_cents = excluded.inexigivel_cents, suspenso_cents = excluded.suspenso_cents,
        pgto_antecipado_cents = excluded.pgto_antecipado_cents, extinto_cents = excluded.extinto_cents,
        saldo_devedor_cents = excluded.saldo_devedor_cents, recebido_em = now()
      where d.atualizacao is null or excluded.atualizacao is null or excluded.atualizacao >= d.atualizacao;
      n := n + 1;
    end loop;
  elsif v.recurso in ('pagamentos','recolhimentos') then
    for l in select * from jsonb_array_elements(p_linhas) loop
      insert into rtc_cbs_pagamento as p (tenant_id, apuracao_id, recurso, data_arrecadacao,
        numero_darf, tipo, ni_adquirente, ni_contribuinte, sequencial, pa, vencimento,
        ni_fornecedor, chave_dfe, principal_cents, multa_cents, juros_cents, total_cents)
      values (v.tenant_id, v.id, v.recurso, (l->>'data_arrecadacao')::date, l->>'numero_darf',
        (l->>'tipo')::int, l->>'ni_adquirente', l->>'ni_contribuinte', (l->>'sequencial')::int,
        rtc_pa_data(l->>'pa'), nullif(l->>'vencimento','')::date, l->>'ni_fornecedor',
        l->>'chave_dfe', (l->>'principal_cents')::bigint, (l->>'multa_cents')::bigint,
        (l->>'juros_cents')::bigint, (l->>'total_cents')::bigint)
      on conflict (tenant_id, recurso, numero_darf, sequencial) do update set
        apuracao_id = excluded.apuracao_id, data_arrecadacao = excluded.data_arrecadacao,
        tipo = excluded.tipo, ni_adquirente = excluded.ni_adquirente,
        ni_contribuinte = excluded.ni_contribuinte, pa = excluded.pa,
        vencimento = excluded.vencimento, ni_fornecedor = excluded.ni_fornecedor,
        chave_dfe = excluded.chave_dfe, principal_cents = excluded.principal_cents,
        multa_cents = excluded.multa_cents, juros_cents = excluded.juros_cents,
        total_cents = excluded.total_cents, recebido_em = now();
      n := n + 1;
    end loop;
  elsif jsonb_array_length(p_linhas) > 0 then
    -- créditos: estrutura própria (apropriação/utilização), ainda sem leitor.
    -- O arquivo fica guardado em payload; nada é lançado no escuro.
    raise exception 'recurso % ainda sem gravacao de linhas', v.recurso;
  end if;

  update rtc_apuracao set status = 'disponivel', recebido_em = now(),
         erro = null, tiquete_download = null
   where id = v.id;

  perform log_audit(v.tenant_id, 'apuracao.ingest_v2', 'rtc_apuracao', v.id::text, null,
                    jsonb_build_object('recurso', v.recurso, 'linhas', n));
  return jsonb_build_object('ok', true, 'linhas', n, 'recurso', v.recurso);
end $function$;

-- Quem pode gerar DARF: dono, finanças e administradores. Gerar DARF cria
-- documento oficial na Receita — leitura do escopo não basta.
create or replace function public.rtc_pode_emitir_darf(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $$
  select in_scope(p_tenant)
     and coalesce(role_in(p_tenant) in ('platform_admin','channel_admin','owner','finance'), false)
$$;

-- Registro do DARF pedido, com auditoria. Chamado só pelo servidor, que já
-- conferiu a permissão do usuário logado.
create or replace function public.rtc_cbs_darf_registrar(p_tenant uuid, p_usuario uuid, p_registro jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_id uuid;
begin
  insert into rtc_cbs_darf (tenant_id, tipo, pa, chave_dfe, opcao_pagamento, valor_parcial_cents,
    pedido, http_status, cd_retorno, gerado, chave_pix, codigo_barras, link_pdf, data_maxima,
    principal_cents, multa_cents, juros_cents, total_cents, mensagem, dados_invalidos, solicitado_por)
  values (p_tenant, p_registro->>'tipo', p_registro->>'pa', p_registro->>'chave_dfe',
    p_registro->>'opcao_pagamento', nullif(p_registro->>'valor_parcial_cents','')::bigint,
    coalesce(p_registro->'pedido', '{}'::jsonb), nullif(p_registro->>'http_status','')::int,
    coalesce(p_registro->>'cd_retorno', 'SEM_CODIGO'), coalesce((p_registro->>'gerado')::boolean, false),
    p_registro->>'chave_pix', p_registro->>'codigo_barras', p_registro->>'link_pdf',
    nullif(p_registro->>'data_maxima','')::date,
    nullif(p_registro->>'principal_cents','')::bigint, nullif(p_registro->>'multa_cents','')::bigint,
    nullif(p_registro->>'juros_cents','')::bigint, nullif(p_registro->>'total_cents','')::bigint,
    left(p_registro->>'mensagem', 1000),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_registro->'dados_invalidos','[]'::jsonb))), '{}'),
    p_usuario)
  returning id into v_id;

  perform log_audit(p_tenant, 'darf.gerar', 'rtc_cbs_darf', v_id::text, null,
    jsonb_build_object('tipo', p_registro->>'tipo', 'pa', p_registro->>'pa',
                       'cd_retorno', p_registro->>'cd_retorno', 'gerado', p_registro->'gerado',
                       'total_cents', p_registro->'total_cents', 'usuario', p_usuario));
  return v_id;
end $function$;

revoke all on function public.rtc_pa_data(text) from public, anon;
revoke all on function public.rtc_cbs_v2_ingerir(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rtc_pode_emitir_darf(uuid) from public, anon;
revoke all on function public.rtc_cbs_darf_registrar(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rtc_pa_data(text) to authenticated, service_role;
grant execute on function public.rtc_cbs_v2_ingerir(uuid, jsonb) to service_role;
grant execute on function public.rtc_pode_emitir_darf(uuid) to authenticated, service_role;
grant execute on function public.rtc_cbs_darf_registrar(uuid, uuid, jsonb) to service_role;
