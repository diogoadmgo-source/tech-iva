-- 0070b_credentials_lifecycle.sql
-- ESPELHO da migration aplicada no banco (não reaplicar).
-- Revogação pelo cliente, leitura para a tela e vigilância de vencimento.

-- O cliente pode revogar. Direito dele: apagamos o ponteiro do segredo.
create or replace function revoke_credential(p_id uuid, p_reason text default null)
returns void language plpgsql security definer
set search_path to 'public', 'extensions' as $$
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

-- Tela de integrações: nada sensível sai daqui (sem secret_ref).
create or replace function credentials_status(p_tenant uuid)
returns table(
  id uuid, provider text, kind credential_kind, status credential_status,
  subject_cn text, subject_cnpj text, not_after date, dias_para_expirar integer,
  last_used_at timestamptz, last_error text
) language plpgsql stable security definer
set search_path to 'public', 'extensions' as $$
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

-- Certificado A1 vale 1 ano; vencer significa parar de ingerir notas.
create or replace function check_expiring_credentials()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions' as $$
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
            (case when r.dias <= 7 then 'critical' else 'warning' end)::alert_severity,
            'Credencial de '||r.provider||' expira em '||r.dias||' dias',
            jsonb_build_object('credential_id', r.id, 'not_after', r.not_after));
    n := n + 1;
  end loop;

  update integration_credentials set status='expirada'
   where status='ativa' and not_after is not null and not_after < current_date;
  return n;
end $$;

revoke all on function check_expiring_credentials() from authenticated, anon;
