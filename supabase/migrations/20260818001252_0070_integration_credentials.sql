-- Migration 20260818001252 (0070_integration_credentials) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- CREDENCIAIS DE INTEGRAÇÃO POR EMPRESA
-- ============================================================================
-- PRINCÍPIO: o segredo (certificado A1 / chave de API) NUNCA é gravado nesta
-- tabela nem trafega pelo navegador depois do upload. Aqui ficam só METADADOS:
-- o que é, de quem é, validade, impressão digital e um ponteiro (secret_ref)
-- para o cofre onde o material cifrado está.
--
-- Modelos suportados, do mais seguro para o menos:
--   1. procuracao  — o cliente nos nomeia procurador no e-CAC. NÓS usamos NOSSO
--                    certificado. Não guardamos chave privada de ninguém.
--                    É o modelo recomendado e o padrão do produto.
--   2. api_key     — o cliente gera a credencial no Portal RTC e cola aqui.
--                    Revogável por ele a qualquer momento.
--   3. certificado — upload de A1 (.pfx + senha). Só quando não houver alternativa:
--                    é uma chave privada que assina em nome da empresa.

create type credential_kind as enum ('procuracao','api_key','certificado_a1');
create type credential_status as enum ('pendente','ativa','expirada','revogada','erro');

create table integration_credentials (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  provider     text not null,                    -- 'dfe' | 'rtc_cbs' | 'openfinance'
  kind         credential_kind not null,
  status       credential_status not null default 'pendente',

  -- ponteiro para o material cifrado; NUNCA o material em si
  secret_ref   text,

  -- metadados verificáveis, seguros de exibir
  subject_cn   text,                             -- titular do certificado
  subject_cnpj text,
  fingerprint  text,                             -- SHA-256 do certificado
  not_before   date,
  not_after    date,                             -- validade: alimenta o alerta
  scopes       text[] not null default '{}',

  last_used_at timestamptz,
  last_error   text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid,
  unique (tenant_id, provider, kind)
);
create index intcred_tenant on integration_credentials (tenant_id, provider);
create index intcred_expiring on integration_credentials (not_after)
  where status = 'ativa' and not_after is not null;

alter table integration_credentials enable row level security;

-- Leitura: escopo, mas SEM o segredo (não há segredo aqui).
create policy intcred_select on integration_credentials for select to authenticated
  using (in_scope(tenant_id));
-- Escrita pelo cliente: nunca direta. Só por RPC/serviço.
grant select on integration_credentials to authenticated;
grant all on integration_credentials to service_role;

create trigger audit_intcred after insert or update or delete on integration_credentials
  for each row execute function audit_row();

-- Registro de metadados após o upload/validação feita pelo SERVIÇO.
create or replace function register_credential(
  p_tenant uuid, p_provider text, p_kind credential_kind, p_secret_ref text,
  p_subject_cn text default null, p_subject_cnpj text default null,
  p_fingerprint text default null, p_not_before date default null, p_not_after date default null,
  p_scopes text[] default '{}')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  -- só o serviço grava: ele é quem viu o material e extraiu os metadados
  if current_setting('role', true) is distinct from 'service_role'
     and auth.uid() is not null then
    raise exception 'forbidden: use o fluxo de upload do servidor';
  end if;

  insert into integration_credentials
    (tenant_id, provider, kind, status, secret_ref, subject_cn, subject_cnpj,
     fingerprint, not_before, not_after, scopes)
  values (p_tenant, p_provider, p_kind, 'ativa', p_secret_ref, p_subject_cn, p_subject_cnpj,
          p_fingerprint, p_not_before, p_not_after, p_scopes)
  on conflict (tenant_id, provider, kind) do update
    set status='ativa', secret_ref=excluded.secret_ref, subject_cn=excluded.subject_cn,
        subject_cnpj=excluded.subject_cnpj, fingerprint=excluded.fingerprint,
        not_before=excluded.not_before, not_after=excluded.not_after,
        scopes=excluded.scopes, last_error=null, revoked_at=null, revoked_by=null
  returning id into v_id;

  perform log_audit(p_tenant, 'credential.register', 'integration_credential', v_id::text, null,
    jsonb_build_object('provider',p_provider,'kind',p_kind,'cnpj',p_subject_cnpj,
                       'fingerprint',p_fingerprint,'not_after',p_not_after));
  return v_id;
end $$;
revoke execute on function register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[])
  from public, anon, authenticated;
grant execute on function register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[])
  to service_role;

-- Revogar: o CLIENTE pode, a qualquer momento. É direito dele.
create or replace function revoke_credential(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from integration_credentials where id = p_id;
  if v_tenant is null then raise exception 'not found'; end if;
  if not has_role(v_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;
  perform require_aal2();

  update integration_credentials
     set status='revogada', revoked_at=now(), revoked_by=auth.uid(), secret_ref=null
   where id = p_id;

  perform log_audit(v_tenant, 'credential.revoke', 'integration_credential', p_id::text,
                    null, jsonb_build_object('reason', p_reason));
end $$;
grant execute on function revoke_credential(uuid, text) to authenticated;

-- Situação das credenciais para a tela de integrações (sem nada sensível).
create or replace function credentials_status(p_tenant uuid)
returns table (id uuid, provider text, kind credential_kind, status credential_status,
               subject_cn text, subject_cnpj text, not_after date, dias_para_expirar int,
               last_used_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select c.id, c.provider, c.kind, c.status, c.subject_cn, c.subject_cnpj, c.not_after,
         case when c.not_after is null then null else (c.not_after - current_date) end,
         c.last_used_at, c.last_error
  from integration_credentials c
  where c.tenant_id = p_tenant and c.status <> 'revogada'
  order by c.provider, c.kind;
end $$;
grant execute on function credentials_status(uuid) to authenticated;

-- Alerta de expiração: certificado A1 vale 1 ano e vencer significa parar de
-- ingerir notas. Avisa em 30, 15 e 7 dias.
create or replace function check_expiring_credentials()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0;
begin
  for r in
    select id, tenant_id, provider, subject_cn, not_after, (not_after - current_date) dias
    from integration_credentials
    where status='ativa' and not_after is not null
      and (not_after - current_date) in (30, 15, 7, 1)
  loop
    insert into alerts (tenant_id, kind, severity, title, payload)
    values (r.tenant_id, 'credential_expiring',
            case when r.dias <= 7 then 'critical' else 'warning' end,
            'Credencial de '||r.provider||' expira em '||r.dias||' dias',
            jsonb_build_object('credential_id', r.id, 'not_after', r.not_after));
    n := n + 1;
  end loop;

  update integration_credentials set status='expirada'
   where status='ativa' and not_after is not null and not_after < current_date;
  return n;
end $$;
revoke execute on function check_expiring_credentials() from public, anon, authenticated;
grant execute on function check_expiring_credentials() to service_role;
