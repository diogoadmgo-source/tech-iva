-- 0201_register_credential_renovacao.sql
-- Renovação anual: reenvio do mesmo provider/kind atualiza o registro existente
-- em vez de violar integration_credentials_tenant_id_provider_kind_key.
create or replace function public.register_credential(
  p_tenant uuid, p_provider text, p_kind credential_kind, p_secret_ref text,
  p_subject_cn text default null, p_subject_cnpj text default null,
  p_fingerprint text default null, p_not_before date default null,
  p_not_after date default null, p_scopes text[] default '{}'::text[],
  p_finalidades text[] default array['ingest_dfe','consulta_apuracao'],
  p_uploaded_by_role text default null, p_uploaded_on_behalf boolean default false)
returns uuid
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_id uuid; v_old jsonb;
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;

  select to_jsonb(c) into v_old
    from integration_credentials c
   where c.tenant_id = p_tenant and c.provider = p_provider and c.kind = p_kind;

  insert into integration_credentials (tenant_id, provider, kind, status, secret_ref, subject_cn,
                                      subject_cnpj, fingerprint, not_before, not_after, scopes,
                                      finalidades, uploaded_by_role, uploaded_on_behalf, created_by)
  values (p_tenant, p_provider, p_kind,
          case when p_kind = 'procuracao' then 'pendente'::credential_status
               else 'ativa'::credential_status end,
          p_secret_ref, p_subject_cn, p_subject_cnpj, p_fingerprint, p_not_before, p_not_after,
          coalesce(p_scopes, '{}'::text[]),
          coalesce(p_finalidades, array['ingest_dfe','consulta_apuracao']),
          p_uploaded_by_role, coalesce(p_uploaded_on_behalf, false), auth.uid())
  on conflict (tenant_id, provider, kind) do update
     set status = excluded.status,
         secret_ref = excluded.secret_ref,
         subject_cn = excluded.subject_cn,
         subject_cnpj = excluded.subject_cnpj,
         fingerprint = excluded.fingerprint,
         not_before = excluded.not_before,
         not_after = excluded.not_after,
         scopes = excluded.scopes,
         finalidades = excluded.finalidades,
         uploaded_by_role = excluded.uploaded_by_role,
         uploaded_on_behalf = excluded.uploaded_on_behalf,
         created_by = excluded.created_by,
         created_at = now(),
         last_error = null,
         falhas_consecutivas = 0,
         revoked_at = null,
         revoked_by = null
  returning id into v_id;

  perform log_audit(p_tenant,
                    case when v_old is null then 'credential.register' else 'credential.renew' end,
                    'integration_credentials', v_id::text, v_old,
                    jsonb_build_object('kind', p_kind, 'provider', p_provider,
                                       'fingerprint', p_fingerprint, 'not_after', p_not_after,
                                       'finalidades', coalesce(p_finalidades, array['ingest_dfe','consulta_apuracao']),
                                       'uploaded_by_role', p_uploaded_by_role,
                                       'uploaded_on_behalf', coalesce(p_uploaded_on_behalf, false)));
  return v_id;
end $function$;

grant execute on function public.register_credential(
  uuid, text, credential_kind, text, text, text, text, date, date, text[], text[], text, boolean
) to authenticated, service_role;