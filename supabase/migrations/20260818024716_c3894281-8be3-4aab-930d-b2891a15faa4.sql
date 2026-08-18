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
declare v_id uuid;
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;

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
  returning id into v_id;

  perform log_audit(p_tenant, 'credential.register', 'integration_credentials', v_id::text, null::jsonb,
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