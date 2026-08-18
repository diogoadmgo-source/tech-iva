CREATE OR REPLACE FUNCTION public.register_credential(p_tenant uuid, p_provider text, p_kind credential_kind, p_secret_ref text, p_subject_cn text DEFAULT NULL::text, p_subject_cnpj text DEFAULT NULL::text, p_fingerprint text DEFAULT NULL::text, p_not_before date DEFAULT NULL::date, p_not_after date DEFAULT NULL::date, p_scopes text[] DEFAULT '{}'::text[], p_finalidades text[] DEFAULT ARRAY['ingest_dfe'::text, 'consulta_apuracao'::text], p_uploaded_by_role text DEFAULT NULL::text, p_uploaded_on_behalf boolean DEFAULT false, p_caller uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_id uuid; v_antiga uuid; v_ator uuid := coalesce(auth.uid(), p_caller);
begin
  -- Chamada pelo servidor (service role) não carrega auth.uid(): nesse caminho a
  -- autorização do papel já foi feita antes por can_admin() com o client do
  -- usuário, e p_caller preserva a autoria para auditoria.
  if auth.uid() is not null then
    if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
      raise exception 'forbidden';
    end if;
  elsif v_ator is null then
    raise exception 'forbidden';
  end if;

  select id into v_antiga from integration_credentials
   where tenant_id = p_tenant and provider = p_provider and kind = p_kind
     and status <> 'revogada'
   limit 1;

  if v_antiga is not null then
    update integration_credentials
       set status = 'revogada', revoked_at = now(), revoked_by = v_ator, secret_ref = null
     where id = v_antiga;
    perform log_audit(p_tenant, 'credential.replace', 'integration_credentials', v_antiga::text,
                      null, jsonb_build_object('motivo','substituída por novo cadastro','ator',v_ator));
  end if;

  insert into integration_credentials (tenant_id, provider, kind, status, secret_ref, subject_cn,
                                      subject_cnpj, fingerprint, not_before, not_after, scopes,
                                      finalidades, uploaded_by_role, uploaded_on_behalf, created_by)
  values (p_tenant, p_provider, p_kind,
          case when p_kind = 'procuracao' then 'pendente'::credential_status
               else 'ativa'::credential_status end,
          p_secret_ref, p_subject_cn, p_subject_cnpj, p_fingerprint, p_not_before, p_not_after,
          coalesce(p_scopes,'{}'::text[]),
          coalesce(p_finalidades, array['ingest_dfe','consulta_apuracao']),
          p_uploaded_by_role, coalesce(p_uploaded_on_behalf,false), v_ator)
  returning id into v_id;

  perform log_audit(p_tenant, 'credential.register', 'integration_credentials', v_id::text, null,
                    jsonb_build_object('kind', p_kind, 'provider', p_provider,
                                       'fingerprint', p_fingerprint, 'not_after', p_not_after,
                                       'substituiu', v_antiga,
                                       'finalidades', coalesce(p_finalidades, array['ingest_dfe','consulta_apuracao']),
                                       'uploaded_by_role', p_uploaded_by_role,
                                       'uploaded_on_behalf', coalesce(p_uploaded_on_behalf,false),
                                       'ator', v_ator));
  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[],text[],text,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[],text[],text,boolean,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[],text[],text,boolean,uuid) TO service_role;
DROP FUNCTION IF EXISTS public.register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[],text[],text,boolean);