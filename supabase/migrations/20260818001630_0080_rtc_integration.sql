-- Migration 20260818001630 (0080_rtc_integration) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- INTEGRAÇÃO COM A PLATAFORMA RTC DA RECEITA
-- ============================================================================
-- Baseado no Manual Plataforma CBS (RFB, maio/2026). Três fatos que definem o desenho:
--
-- 1. NÃO EXISTE API pública hospedada para CÁLCULO. A integração é só pelo
--    componente OFFLINE rodando na nossa infraestrutura (localhost:8080/api).
--    Ele é open source, tem banco embarcado, não faz telemetria e se atualiza
--    pelo mecanismo oficial quando a norma muda.
-- 2. A API de APURAÇÃO ASSISTIDA é remota, exige ClientId/ClientSecret por CNPJ
--    e tem COTA DURA: 2 solicitações por dia por CNPJ (erro 429 se estourar),
--    8 chamadas de download por dia, arquivo disponível por 24h. Fluxo em 3
--    passos: token -> tíquete (com webhook) -> download.
-- 3. Os DADOS ABERTOS trazem a matriz CST × cClassTrib com efeitos tributários,
--    alíquotas e referências legais. Cacheamos localmente para validar antes
--    de emitir e explicar a rejeição ao usuário.

-- ---------------------------------------------------------------- matriz fiscal
create table rtc_class_trib (
  cst              text not null,
  cclasstrib       text not null,
  descricao        text,
  efeito           text,                    -- tributado, reduzido, isento, imune, diferido...
  reducao_pct      numeric(6,3),
  permite_credito  boolean,
  base_legal       text,
  vigencia_inicio  date,
  vigencia_fim     date,
  fonte            text not null default 'dados_abertos_rtc',
  atualizado_em    timestamptz not null default now(),
  primary key (cst, cclasstrib)
);
create index rtc_ct_vigencia on rtc_class_trib (vigencia_inicio, vigencia_fim);

alter table rtc_class_trib enable row level security;
create policy rtc_ct_select on rtc_class_trib for select to authenticated using (true);
grant select on rtc_class_trib to authenticated;
grant all on rtc_class_trib to service_role;

-- Validação local antes de emitir: a combinação CST × cClassTrib existe e está vigente?
-- É a causa mais comum de rejeição pela SEFAZ.
create or replace function validate_class_trib(p_cst text, p_cclasstrib text, p_data date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
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
grant execute on function validate_class_trib(text,text,date) to authenticated;

create or replace function rtc_class_trib_upsert(p jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
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
revoke execute on function rtc_class_trib_upsert(jsonb) from public, anon, authenticated;
grant execute on function rtc_class_trib_upsert(jsonb) to service_role;

-- ---------------------------------------------------------------- cota da API
-- A Receita limita 2 solicitações por dia por CNPJ. Estourar devolve 429 e o
-- cliente fica sem dado. Controlamos ANTES de chamar.
create table rtc_api_quota (
  cnpj8        text not null,               -- a API usa os 8 primeiros dígitos
  dia          date not null,
  solicitacoes int not null default 0,      -- limite 2/dia
  downloads    int not null default 0,      -- limite 8/dia
  ultimo_erro  text,
  primary key (cnpj8, dia)
);
alter table rtc_api_quota enable row level security;
create policy rtc_quota_select on rtc_api_quota for select to authenticated using (is_platform());
grant select on rtc_api_quota to authenticated;
grant all on rtc_api_quota to service_role;

create or replace function rtc_quota_take(p_cnpj text, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8);
        v_limite int := case p_kind when 'solicitacao' then 2 when 'download' then 8 else 0 end;
        v_atual int;
begin
  if v_limite = 0 then raise exception 'tipo de cota invalido: %', p_kind; end if;

  insert into rtc_api_quota (cnpj8, dia) values (v_c8, current_date)
  on conflict (cnpj8, dia) do nothing;

  select case when p_kind='solicitacao' then solicitacoes else downloads end
    into v_atual from rtc_api_quota where cnpj8=v_c8 and dia=current_date for update;

  if v_atual >= v_limite then
    return jsonb_build_object('permitido', false, 'usado', v_atual, 'limite', v_limite,
      'motivo', 'Cota diária da Receita esgotada para este CNPJ ('||v_limite||'/dia). Tente amanhã.');
  end if;

  if p_kind='solicitacao' then
    update rtc_api_quota set solicitacoes = solicitacoes + 1 where cnpj8=v_c8 and dia=current_date;
  else
    update rtc_api_quota set downloads = downloads + 1 where cnpj8=v_c8 and dia=current_date;
  end if;

  return jsonb_build_object('permitido', true, 'usado', v_atual + 1, 'limite', v_limite);
end $$;
revoke execute on function rtc_quota_take(text,text) from public, anon, authenticated;
grant execute on function rtc_quota_take(text,text) to service_role;

-- ---------------------------------------------------------------- apuração assistida
create table rtc_apuracao (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  competencia  date not null,                -- mês de apuração
  status       text not null default 'solicitada', -- solicitada|disponivel|erro|expirada
  tiquete      text,
  webhook_ref  text,
  debitos_cents  bigint,
  creditos_cents bigint,
  pagamentos_cents bigint,
  saldo_cents    bigint,
  payload      jsonb,
  solicitado_em timestamptz not null default now(),
  recebido_em   timestamptz,
  erro          text,
  unique (tenant_id, competencia, solicitado_em)
);
create index rtc_apuracao_tenant on rtc_apuracao (tenant_id, competencia desc);

alter table rtc_apuracao enable row level security;
create policy rtc_apuracao_select on rtc_apuracao for select to authenticated using (in_scope(tenant_id));
grant select on rtc_apuracao to authenticated;
grant all on rtc_apuracao to service_role;

-- Comparar o que NÓS calculamos com o que a RECEITA apurou. É o maior valor do
-- produto para o contador: divergência aparece antes do Fisco cobrar.
create or replace function apuracao_divergencia(p_tenant uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
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
grant execute on function apuracao_divergencia(uuid, date) to authenticated;
