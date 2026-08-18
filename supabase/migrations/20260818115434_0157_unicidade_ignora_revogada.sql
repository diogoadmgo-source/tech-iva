-- Migration 20260818115434 (0157_unicidade_ignora_revogada) — exportada de supabase_migrations.schema_migrations
-- BUG: a unicidade (tenant_id, provider, kind) não distinguia credencial ATIVA de
-- REVOGADA. Revogar não apaga a linha — de propósito, porque o histórico de quem
-- revogou e quando é prova de auditoria e não pode sumir. Mas isso significa que
-- a linha revogada continuava ocupando o lugar, e o recadastro batia em
-- "duplicate key".
--
-- Sintoma real: o cliente revoga um certificado vencido, tenta subir o novo, e o
-- sistema recusa sem explicar por quê. Ele fica sem ingestão sem entender.
--
-- Correção: a unicidade passa a valer apenas entre credenciais NÃO revogadas.
-- Histórico preservado, recadastro liberado.
alter table integration_credentials
  drop constraint if exists integration_credentials_tenant_id_provider_kind_key;

create unique index if not exists integration_credentials_ativa
  on integration_credentials (tenant_id, provider, kind)
  where status <> 'revogada';

-- E register_credential precisa parar de usar ON CONFLICT sobre a restrição que
-- deixou de existir: agora ele revoga a anterior e insere a nova. Assim a
-- substituição (renovação de certificado, troca de chave) fica registrada como
-- duas linhas — a antiga revogada e a nova ativa —, que é o histórico correto.
create or replace function register_credential(
  p_tenant uuid, p_provider text, p_kind credential_kind, p_secret_ref text,
  p_subject_cn text default null, p_subject_cnpj text default null,
  p_fingerprint text default null, p_not_before date default null, p_not_after date default null,
  p_scopes text[] default '{}', p_finalidades text[] default array['ingest_dfe','consulta_apuracao'],
  p_uploaded_by_role text default null, p_uploaded_on_behalf boolean default false)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_antiga uuid;
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;

  -- substitui a anterior, se houver: revoga em vez de sobrescrever
  select id into v_antiga from integration_credentials
   where tenant_id = p_tenant and provider = p_provider and kind = p_kind
     and status <> 'revogada';

  if v_antiga is not null then
    update integration_credentials
       set status = 'revogada', revoked_at = now(), revoked_by = auth.uid(), secret_ref = null
     where id = v_antiga;
    perform log_audit(p_tenant, 'credential.replace', 'integration_credentials', v_antiga::text,
                      null, jsonb_build_object('motivo','substituída por novo cadastro'));
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
          p_uploaded_by_role, coalesce(p_uploaded_on_behalf,false), auth.uid())
  returning id into v_id;

  perform log_audit(p_tenant, 'credential.register', 'integration_credentials', v_id::text, null,
                    jsonb_build_object('kind', p_kind, 'provider', p_provider,
                                       'fingerprint', p_fingerprint, 'not_after', p_not_after,
                                       'substituiu', v_antiga,
                                       'finalidades', coalesce(p_finalidades, array['ingest_dfe','consulta_apuracao']),
                                       'uploaded_by_role', p_uploaded_by_role,
                                       'uploaded_on_behalf', coalesce(p_uploaded_on_behalf,false)));
  return v_id;
end $$;
grant execute on function register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[],text[],text,boolean) to service_role;
revoke execute on function register_credential(uuid,text,credential_kind,text,text,text,text,date,date,text[],text[],text,boolean) from public, anon, authenticated;
