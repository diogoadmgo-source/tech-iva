-- 0070_integration_credentials.sql
-- ESPELHO da migration aplicada no banco (não reaplicar).
--
-- Credenciais de integração por empresa (procuração / chave de API / certificado A1).
-- PRINCÍPIO: a tabela guarda só METADADOS + um ponteiro (secret_ref) para o
-- material cifrado no Storage privado. O .pfx, a senha e a chave de API nunca
-- são gravados aqui, nunca voltam ao navegador e nunca aparecem em log.

create type credential_kind as enum ('procuracao', 'api_key', 'certificado_a1');
create type credential_status as enum ('pendente', 'ativa', 'expirada', 'revogada', 'erro');

create table integration_credentials (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  provider      text not null,
  kind          credential_kind not null,
  status        credential_status not null default 'pendente',
  secret_ref    text,                       -- caminho no bucket privado; nunca exposto ao cliente
  subject_cn    text,
  subject_cnpj  text,
  fingerprint   text,
  not_before    date,
  not_after     date,
  scopes        text[] not null default '{}',
  last_used_at  timestamptz,
  last_error    text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  unique (tenant_id, provider, kind)
);

grant select on integration_credentials to authenticated;
grant all on integration_credentials to service_role;

alter table integration_credentials enable row level security;

-- leitura por escopo hierárquico; escrita SÓ service_role (via register_credential)
create policy intcred_select on integration_credentials
  for select to authenticated using (in_scope(tenant_id));

create trigger audit_intcred
  after insert or update or delete on integration_credentials
  for each row execute function audit_row();

-- Só o servidor grava: ele é quem viu o material e extraiu os metadados.
create or replace function register_credential(
  p_tenant uuid, p_provider text, p_kind credential_kind, p_secret_ref text,
  p_subject_cn text default null, p_subject_cnpj text default null,
  p_fingerprint text default null, p_not_before date default null,
  p_not_after date default null, p_scopes text[] default '{}'
) returns uuid language plpgsql security definer
set search_path to 'public', 'extensions' as $$
declare v_id uuid;
begin
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
