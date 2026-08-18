-- Migration 20260818002055 (0090_calc_simulator_and_validator) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- SIMULADOR DE TRIBUTO + VALIDADOR DE XML (entregues ao cliente)
-- ============================================================================
-- Custo marginal ZERO: a Calculadora oficial roda no nosso container, sem
-- cobrança por chamada e sem telemetria. Vira porta de entrada do produto:
-- resolve a dor imediata (nota rejeitada) e traz o cliente antes de ele
-- precisar do cockpit de caixa.

-- ------------------------------------------------------------- simulações
create table calc_simulations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  nome          text,
  inputs        jsonb not null,        -- cst, cclasstrib, ncm/nbs, base, uf, município, data
  results       jsonb not null,        -- valores por tributo + alíquotas + redução
  memory        jsonb,                 -- memória de cálculo oficial + base legal
  rule_version_id uuid references rule_versions(id),
  calc_version  text,
  share_token   text unique,           -- link de compartilhamento (opcional)
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index calc_sim_tenant on calc_simulations (tenant_id, created_at desc);

alter table calc_simulations enable row level security;
create policy calc_sim_select on calc_simulations for select to authenticated using (in_scope(tenant_id));
grant select on calc_simulations to authenticated;
grant all on calc_simulations to service_role;

create or replace function save_simulation(p_tenant uuid, p_nome text, p_inputs jsonb,
                                           p_results jsonb, p_memory jsonb, p_calc_version text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  insert into calc_simulations (tenant_id, nome, inputs, results, memory, calc_version,
                                rule_version_id, created_by)
  values (p_tenant, p_nome, p_inputs, p_results, p_memory, p_calc_version,
          (select id from rule_versions where is_current limit 1), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function save_simulation(uuid,text,jsonb,jsonb,jsonb,text) to authenticated;

-- Compartilhar uma simulação (a própria calculadora oficial oferece URL/QR).
-- Útil para o contador mandar ao cliente: "é assim que sua operação é tributada".
create or replace function share_simulation(p_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid; v_token text;
begin
  select tenant_id, share_token into v_tenant, v_token from calc_simulations where id = p_id;
  if v_tenant is null or not in_scope(v_tenant) then raise exception 'forbidden'; end if;
  if v_token is null then
    v_token := encode(gen_random_bytes(16),'hex');
    update calc_simulations set share_token = v_token where id = p_id;
    perform log_audit(v_tenant,'simulation.share','calc_simulation',p_id::text,null,null);
  end if;
  return v_token;
end $$;
grant execute on function share_simulation(uuid) to authenticated;

-- ------------------------------------------------------------- validações de XML
create table xml_validations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  filename      text,
  access_key    text,
  modelo        text,
  valido        boolean not null,
  inconsistencias jsonb not null default '[]',
  total_itens   int,
  calc_version  text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index xmlval_tenant on xml_validations (tenant_id, created_at desc);
create index xmlval_invalid on xml_validations (tenant_id) where not valido;

alter table xml_validations enable row level security;
create policy xmlval_select on xml_validations for select to authenticated using (in_scope(tenant_id));
grant select on xml_validations to authenticated;
grant all on xml_validations to service_role;

create or replace function save_xml_validation(p_tenant uuid, p_filename text, p_access_key text,
                                               p_modelo text, p_valido boolean, p_inconsistencias jsonb,
                                               p_total_itens int, p_calc_version text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  insert into xml_validations (tenant_id, filename, access_key, modelo, valido,
                               inconsistencias, total_itens, calc_version, created_by)
  values (p_tenant, p_filename, p_access_key, p_modelo, p_valido,
          coalesce(p_inconsistencias,'[]'::jsonb), p_total_itens, p_calc_version, auth.uid())
  returning id into v_id;

  -- Nota inválida vira alerta: é dinheiro parado esperando rejeição da SEFAZ.
  if not p_valido then
    insert into alerts (tenant_id, kind, severity, title, payload)
    values (p_tenant, 'inconsistent_item', 'warning',
            'XML com inconsistência: '||coalesce(p_filename, coalesce(p_access_key,'documento')),
            jsonb_build_object('validation_id', v_id, 'issues', p_inconsistencias));
  end if;
  return v_id;
end $$;
grant execute on function save_xml_validation(uuid,text,text,text,boolean,jsonb,int,text) to authenticated;

-- O RANKING DOS ERROS RECORRENTES. Aqui mora o valor real: não é validar uma nota,
-- é dizer "você errou a mesma coisa 40 vezes neste mês, e é isto que precisa mudar
-- na parametrização do seu emissor".
create or replace function validation_top_issues(p_tenant uuid, p_dias int default 30)
returns table (codigo text, descricao text, ocorrencias bigint, documentos bigint, ultimo timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select coalesce(i->>'codigo', i->>'code', 'sem_codigo') as codigo,
         coalesce(i->>'descricao', i->>'mensagem', i->>'message') as descricao,
         count(*) as ocorrencias,
         count(distinct v.id) as documentos,
         max(v.created_at) as ultimo
  from xml_validations v
  cross join lateral jsonb_array_elements(v.inconsistencias) i
  where v.tenant_id = p_tenant
    and v.created_at >= now() - make_interval(days => p_dias)
  group by 1, 2
  order by 3 desc
  limit 20;
end $$;
grant execute on function validation_top_issues(uuid,int) to authenticated;

-- Resumo para o painel: quantas validou, quantas passaram, taxa de erro.
create or replace function validation_summary(p_tenant uuid, p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'periodo_dias', p_dias,
    'total', count(*),
    'validos', count(*) filter (where valido),
    'invalidos', count(*) filter (where not valido),
    'taxa_erro', case when count(*) = 0 then 0
                      else round(100.0 * count(*) filter (where not valido) / count(*), 1) end,
    'ultima', max(created_at)
  ) into v
  from xml_validations
  where tenant_id = p_tenant and created_at >= now() - make_interval(days => p_dias);
  return v;
end $$;
grant execute on function validation_summary(uuid,int) to authenticated;
