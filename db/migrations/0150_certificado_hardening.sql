-- 0150_certificado_hardening.sql
-- ESPELHO da migration aplicada por você no fluxa-dev (extraído de
-- pg_get_functiondef / information_schema / pg_indexes).
--
-- Contexto: o CERTIFICADO passou a ser o caminho principal do produto, não a
-- procuração. Guardar chave privada de cliente é responsabilidade, então o
-- padrão de cuidado sobe junto:
--   1. cada uso do certificado fica registrado (credential_usage);
--   2. o cliente consegue ver onde o certificado dele foi usado
--      (credential_usage_report) — é a pergunta que todo cliente sério faz;
--   3. o certificado autoriza FINALIDADES declaradas, não uso genérico
--      (credential_allows + integration_credentials.finalidades);
--   4. quem subiu e se subiu em nome de terceiro fica gravado
--      (uploaded_by_role, uploaded_on_behalf).
--
-- Este arquivo substitui o antigo espelho 0070c_credential_usage.sql, que
-- juntava numa migration só o que no banco são duas (0150 e 0151).

-- ─────────────────────────── colunas novas ────────────────────────────────
-- finalidades: lista FECHADA (validada por trigger, não por CHECK, para poder
-- evoluir sem recriar a constraint). Padrão = o que o produto realmente faz hoje.
alter table public.integration_credentials
  add column if not exists finalidades text[] not null
    default array['ingest_dfe','consulta_apuracao'],
  add column if not exists uploaded_by_role text,
  add column if not exists uploaded_on_behalf boolean not null default false;

-- ───────────────────────── trilha de uso ──────────────────────────────────
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

-- O cliente LÊ no escopo dele. Não existe update nem delete para authenticated:
-- trilha de uso de certificado que pode ser editada não serve como prova.
grant select on public.credential_usage to authenticated;
grant all on public.credential_usage to service_role;
grant usage, select on sequence public.credential_usage_id_seq to service_role;

alter table public.credential_usage enable row level security;
drop policy if exists credusage_select on public.credential_usage;
create policy credusage_select on public.credential_usage
  for select to authenticated using (in_scope(tenant_id));

-- ───────────────────────────── funções ────────────────────────────────────
-- A credencial autoriza ESTA finalidade? (ativa, dentro da validade)
create or replace function public.credential_allows(p_credential uuid, p_finalidade text)
returns boolean
language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select exists (select 1 from integration_credentials
                 where id = p_credential and status = 'ativa'
                   and p_finalidade = any(finalidades)
                   and (not_after is null or not_after >= current_date));
$function$;

-- Extrato de uso para o CLIENTE (últimos 90 dias por padrão).
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

-- Vigilância de volume atípico (rodada pelo worker; limiar a calibrar com dado real).
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

-- log_credential_use nasce aqui; a versão TOLERANTE A FALHA está na 0151.

revoke all on function public.credential_allows(uuid, text) from public, anon, authenticated;
revoke all on function public.check_credential_anomalies() from public, anon, authenticated;
revoke all on function public.credential_usage_report(uuid, integer) from public, anon;
grant execute on function public.credential_allows(uuid, text) to service_role;
grant execute on function public.check_credential_anomalies() to service_role;
grant execute on function public.credential_usage_report(uuid, integer) to authenticated, service_role;
