-- Migration 20260818012113 (0150_certificado_hardening) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- ENDURECIMENTO DO CERTIFICADO DIGITAL — decisão: certificado é o caminho principal
-- ============================================================================
-- Se o certificado é o padrão do produto, o padrão de cuidado tem que subir junto.
-- Um .pfx assina em nome da empresa para QUALQUER finalidade, não só baixar nota.
-- O que se protege aqui não é um arquivo: é a identidade digital do cliente.

-- ---------------------------------------------------------------- 1. uso rastreado
-- Não basta saber que o certificado existe. Precisamos saber cada vez que ele foi
-- usado, para quê e por qual processo — é o que responde "vocês usaram meu
-- certificado para quê?" com prova, não com promessa.
create table credential_usage (
  id           bigserial primary key,
  credential_id uuid not null references integration_credentials(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  finalidade   text not null,            -- 'ingest_dfe' | 'consulta_apuracao' | ...
  job_id       uuid,
  worker       text,
  sucesso      boolean not null,
  detalhe      text,
  usado_em     timestamptz not null default now()
);
create index credusage_cred on credential_usage (credential_id, usado_em desc);
create index credusage_tenant on credential_usage (tenant_id, usado_em desc);

alter table credential_usage enable row level security;
create policy credusage_select on credential_usage for select to authenticated
  using (in_scope(tenant_id));
grant select on credential_usage to authenticated;
grant all on credential_usage to service_role;
revoke update, delete on credential_usage from authenticated;

create or replace function log_credential_use(p_credential uuid, p_finalidade text,
                                              p_sucesso boolean, p_job uuid default null,
                                              p_worker text default null, p_detalhe text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from integration_credentials where id = p_credential;
  if v_tenant is null then raise exception 'credencial inexistente'; end if;

  insert into credential_usage (credential_id, tenant_id, finalidade, job_id, worker, sucesso, detalhe)
  values (p_credential, v_tenant, p_finalidade, p_job, p_worker, p_sucesso, left(p_detalhe, 500));

  update integration_credentials
     set last_used_at = now(),
         last_error = case when p_sucesso then null else left(p_detalhe,500) end,
         status = case when p_sucesso then status else 'erro'::credential_status end
   where id = p_credential;
end $$;
revoke execute on function log_credential_use(uuid,text,boolean,uuid,text,text) from public, anon, authenticated;
grant execute on function log_credential_use(uuid,text,boolean,uuid,text,text) to service_role;

-- Extrato para o cliente: "onde meu certificado foi usado"
create or replace function credential_usage_report(p_tenant uuid, p_dias int default 90)
returns table (usado_em timestamptz, finalidade text, sucesso boolean, detalhe text,
               subject_cn text, fingerprint text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select u.usado_em, u.finalidade, u.sucesso, u.detalhe, c.subject_cn, c.fingerprint
  from credential_usage u
  join integration_credentials c on c.id = u.credential_id
  where u.tenant_id = p_tenant and u.usado_em >= now() - make_interval(days => p_dias)
  order by u.usado_em desc;
end $$;
grant execute on function credential_usage_report(uuid,int) to authenticated;

-- ---------------------------------------------------------------- 2. finalidade declarada
-- O certificado é aceito para um conjunto FECHADO de finalidades. Se amanhã
-- alguém quiser usá-lo para outra coisa, tem que passar por aqui — e o cliente
-- vê a lista na tela antes de subir o arquivo.
alter table integration_credentials
  add column if not exists finalidades text[] not null default array['ingest_dfe','consulta_apuracao'];

comment on column integration_credentials.finalidades is
  'Finalidades declaradas ao cliente no momento do upload. O worker deve recusar uso fora desta lista.';

create or replace function credential_allows(p_credential uuid, p_finalidade text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from integration_credentials
                 where id = p_credential and status = 'ativa'
                   and p_finalidade = any(finalidades)
                   and (not_after is null or not_after >= current_date));
$$;
revoke execute on function credential_allows(uuid,text) from public, anon, authenticated;
grant execute on function credential_allows(uuid,text) to service_role;

-- ---------------------------------------------------------------- 3. quem subiu
-- Se o administrador da plataforma subir o certificado pelo cliente, isso fica
-- explícito e visível PARA O CLIENTE — não só na auditoria interna.
alter table integration_credentials
  add column if not exists uploaded_by_role text,
  add column if not exists uploaded_on_behalf boolean not null default false;

comment on column integration_credentials.uploaded_on_behalf is
  'true quando alguém da plataforma/canal subiu em nome do cliente. A tela do cliente deve mostrar isso.';

-- ---------------------------------------------------------------- 4. alerta de uso anômalo
-- Certificado usado fora do horário habitual ou em volume atípico merece aviso.
-- Não bloqueia (falso positivo travaria a operação), mas avisa.
create or replace function check_credential_anomalies()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0;
begin
  for r in
    select u.tenant_id, u.credential_id, count(*) usos, max(u.usado_em) ultimo
    from credential_usage u
    where u.usado_em >= now() - interval '1 hour'
    group by 1,2
    having count(*) > 50            -- limiar inicial; ajustar com dado real
  loop
    insert into alerts (tenant_id, kind, severity, title, payload)
    values (r.tenant_id, 'credential_anomaly', 'warning',
            'Uso atípico do certificado: '||r.usos||' operações na última hora',
            jsonb_build_object('credential_id', r.credential_id, 'usos', r.usos));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function check_credential_anomalies() from public, anon, authenticated;
grant execute on function check_credential_anomalies() to service_role;
