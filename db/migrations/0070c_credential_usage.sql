-- 0070c_credential_usage.sql
-- ESPELHO de tabela + funções que existiam no banco sem arquivo em db/migrations.
--
-- Trilha de uso do certificado/credencial: cada operação assinada é registrada.
-- É o que permite responder "onde meu certificado foi usado" e o que desabilita
-- automaticamente uma credencial que falha três vezes seguidas (senão o worker
-- fica batendo na Receita com credencial morta e o cliente não sabe).
-- Extraído de pg_get_functiondef / pg_indexes.

create table if not exists public.credential_usage (
  id bigserial primary key,
  credential_id uuid not null references public.integration_credentials(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  finalidade text not null,
  job_id uuid,
  worker text,
  sucesso boolean not null,
  detalhe text,
  usado_em timestamptz not null default now()
);
create index if not exists credusage_tenant on public.credential_usage (tenant_id, usado_em desc);
create index if not exists credusage_cred on public.credential_usage (credential_id, usado_em desc);

-- Leitura no escopo; a escrita é só do worker (service_role), via log_credential_use.
grant select, insert on public.credential_usage to authenticated;
grant usage, select on sequence public.credential_usage_id_seq to service_role;
grant all on public.credential_usage to service_role;

alter table public.credential_usage enable row level security;
drop policy if exists credusage_select on public.credential_usage;
create policy credusage_select on public.credential_usage
  for select to authenticated using (in_scope(tenant_id));

-- A credencial pode ser usada para esta finalidade? (ativa, dentro da validade)
create or replace function public.credential_allows(p_credential uuid, p_finalidade text)
returns boolean
language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select exists (select 1 from integration_credentials
                 where id = p_credential and status = 'ativa'
                   and p_finalidade = any(finalidades)
                   and (not_after is null or not_after >= current_date));
$function$;

-- Registra o uso e cuida do ciclo de vida: sucesso reabilita, 3 falhas seguidas
-- marcam a credencial como 'erro' e abrem alerta crítico.
create or replace function public.log_credential_use(p_credential uuid, p_finalidade text, p_sucesso boolean,
                                                     p_job uuid default null::uuid, p_worker text default null::text,
                                                     p_detalhe text default null::text)
returns void
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_tenant uuid; v_falhas int;
begin
  select tenant_id into v_tenant from integration_credentials where id = p_credential;
  if v_tenant is null then raise exception 'credencial inexistente'; end if;

  insert into credential_usage (credential_id, tenant_id, finalidade, job_id, worker, sucesso, detalhe)
  values (p_credential, v_tenant, p_finalidade, p_job, p_worker, p_sucesso, left(p_detalhe, 500));

  if p_sucesso then
    -- sucesso limpa o histórico de falhas e reabilita
    update integration_credentials
       set last_used_at = now(), last_error = null, falhas_consecutivas = 0,
           status = case when status = 'erro' then 'ativa'::credential_status else status end
     where id = p_credential;
  else
    update integration_credentials
       set last_used_at = now(), last_error = left(p_detalhe,500),
           falhas_consecutivas = falhas_consecutivas + 1
     where id = p_credential
    returning falhas_consecutivas into v_falhas;

    -- só depois de 3 falhas seguidas consideramos que há problema real
    if v_falhas >= 3 then
      update integration_credentials set status = 'erro' where id = p_credential;
      insert into alerts (tenant_id, kind, severity, title, payload)
      values (v_tenant, 'credential_error', 'critical',
              'Certificado com falha em 3 tentativas seguidas — ingestão parada',
              jsonb_build_object('credential_id', p_credential, 'ultimo_erro', left(p_detalhe,300)));
    end if;
  end if;
end $function$;

-- Extrato de uso para o cliente (últimos 90 dias por padrão).
create or replace function public.credential_usage_report(p_tenant uuid, p_dias integer default 90)
returns table(usado_em timestamptz, finalidade text, sucesso boolean, detalhe text, subject_cn text, fingerprint text)
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select u.usado_em, u.finalidade, u.sucesso, u.detalhe, c.subject_cn, c.fingerprint
  from credential_usage u
  join integration_credentials c on c.id = u.credential_id
  where u.tenant_id = p_tenant and u.usado_em >= now() - make_interval(days => p_dias)
  order by u.usado_em desc;
end $function$;

-- Vigilância de uso atípico (rodada pelo worker; limiar inicial a calibrar).
create or replace function public.check_credential_anomalies()
returns integer
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
end $function$;

revoke all on function public.credential_allows(uuid, text) from public, anon, authenticated;
revoke all on function public.log_credential_use(uuid, text, boolean, uuid, text, text) from public, anon, authenticated;
revoke all on function public.check_credential_anomalies() from public, anon, authenticated;
revoke all on function public.credential_usage_report(uuid, integer) from public, anon;
grant execute on function public.credential_allows(uuid, text) to service_role;
grant execute on function public.log_credential_use(uuid, text, boolean, uuid, text, text) to service_role;
grant execute on function public.check_credential_anomalies() to service_role;
grant execute on function public.credential_usage_report(uuid, integer) to authenticated, service_role;
