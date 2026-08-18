-- 0090_calc_simulator_and_validator.sql
-- ESPELHO da migration aplicada pelo usuário no banco. NÃO reaplicar.
--
-- Entrega ao cliente a CALCULADORA (simulador) e o VALIDADOR DE XML como
-- funcionalidade de entrada: custo marginal zero (o componente oficial da RFB
-- roda no nosso container, sem cobrança por chamada e sem telemetria) e ataca a
-- dor aguda de hoje — nota rejeitada por CST × cClassTrib incoerente — usando a
-- ferramenta oficial da Receita, sem reimplementar regra de SEFAZ.

begin;

/* ------------------------------------------------------------- SIMULADOR */

create table if not exists public.calc_simulations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text,
  inputs jsonb not null,
  results jsonb not null,
  memory jsonb,
  rule_version_id uuid references public.rule_versions(id),
  calc_version text,
  share_token text unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists calc_simulations_tenant_idx
  on public.calc_simulations (tenant_id, created_at desc);

grant select on public.calc_simulations to authenticated;
grant all on public.calc_simulations to service_role;

alter table public.calc_simulations enable row level security;

drop policy if exists calc_sim_select on public.calc_simulations;
create policy calc_sim_select on public.calc_simulations
  for select to authenticated using (in_scope(tenant_id));
-- escrita só pelas RPCs security definer abaixo

create or replace function public.save_simulation(
  p_tenant uuid, p_nome text, p_inputs jsonb, p_results jsonb,
  p_memory jsonb, p_calc_version text
) returns uuid
language plpgsql security definer set search_path to 'public','extensions' as $$
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

-- Link compartilhável (a calculadora oficial já tem o conceito de URL/QR).
create or replace function public.share_simulation(p_id uuid)
returns text
language plpgsql security definer set search_path to 'public','extensions' as $$
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

revoke all on function public.save_simulation(uuid,text,jsonb,jsonb,jsonb,text) from public, anon;
revoke all on function public.share_simulation(uuid) from public, anon;
grant execute on function public.save_simulation(uuid,text,jsonb,jsonb,jsonb,text) to authenticated;
grant execute on function public.share_simulation(uuid) to authenticated;

/* -------------------------------------------------------------- VALIDADOR */

create table if not exists public.xml_validations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  filename text,
  access_key text,
  modelo text,
  valido boolean not null,
  inconsistencias jsonb not null default '[]'::jsonb,
  total_itens integer,
  calc_version text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists xml_validations_tenant_idx
  on public.xml_validations (tenant_id, created_at desc);

grant select on public.xml_validations to authenticated;
grant all on public.xml_validations to service_role;

alter table public.xml_validations enable row level security;

drop policy if exists xmlval_select on public.xml_validations;
create policy xmlval_select on public.xml_validations
  for select to authenticated using (in_scope(tenant_id));

create or replace function public.save_xml_validation(
  p_tenant uuid, p_filename text, p_access_key text, p_modelo text,
  p_valido boolean, p_inconsistencias jsonb, p_total_itens integer, p_calc_version text
) returns uuid
language plpgsql security definer set search_path to 'public','extensions' as $$
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

create or replace function public.validation_summary(p_tenant uuid, p_dias integer default 30)
returns jsonb
language plpgsql stable security definer set search_path to 'public','extensions' as $$
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

-- Ranking: o valor não é validar uma nota, é descobrir que o emissor erra a
-- MESMA coisa dezenas de vezes por mês e corrigir a parametrização.
create or replace function public.validation_top_issues(p_tenant uuid, p_dias integer default 30)
returns table(codigo text, descricao text, ocorrencias bigint, documentos bigint, ultimo timestamptz)
language plpgsql stable security definer set search_path to 'public','extensions' as $$
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

revoke all on function public.save_xml_validation(uuid,text,text,text,boolean,jsonb,integer,text) from public, anon;
revoke all on function public.validation_summary(uuid,integer) from public, anon;
revoke all on function public.validation_top_issues(uuid,integer) from public, anon;
grant execute on function public.save_xml_validation(uuid,text,text,text,boolean,jsonb,integer,text) to authenticated;
grant execute on function public.validation_summary(uuid,integer) to authenticated;
grant execute on function public.validation_top_issues(uuid,integer) to authenticated;

commit;
