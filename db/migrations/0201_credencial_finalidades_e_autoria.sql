-- 0201_credencial_finalidades_e_autoria.sql (minha faixa começa em 0200)
-- MINHA migration (não é espelho): o que a 0150 criou no banco não estava
-- alcançável pelo front. register_credential não recebia finalidades nem autoria,
-- e credentials_status não devolvia finalidades, falhas_consecutivas nem quem
-- subiu — ou seja, as colunas existiriam sempre com o default e a tela não teria
-- o que mostrar. APLICAR NO techiva-prod junto das 0150/0151.

-- ─────────────────── finalidades: lista fechada, validada ─────────────────
-- Trigger em vez de CHECK para poder evoluir a lista sem recriar a constraint.
create or replace function public.finalidades_validas(p_finalidades text[])
returns boolean
language sql immutable set search_path to 'public'
as $function$
  select p_finalidades <@ array['ingest_dfe','consulta_apuracao','emissao_documento']::text[]
     and array_length(p_finalidades, 1) >= 1;
$function$;

create or replace function public.integration_credentials_check_finalidades()
returns trigger
language plpgsql set search_path to 'public'
as $function$
begin
  if not finalidades_validas(new.finalidades) then
    raise exception 'finalidade não permitida: %', new.finalidades;
  end if;
  return new;
end $function$;

drop trigger if exists trg_credentials_finalidades on public.integration_credentials;
create trigger trg_credentials_finalidades
  before insert or update of finalidades on public.integration_credentials
  for each row execute function public.integration_credentials_check_finalidades();

-- ───────────────────── register_credential com autoria ────────────────────
-- A versão de 10 parâmetros é REMOVIDA: com as duas coexistindo, chamada com os
-- 10 argumentos originais fica ambígua e falha em runtime.
drop function if exists public.register_credential(uuid, text, credential_kind, text, text, text, text, date, date, text[]);

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
  -- has_role(): guarda que não passa com papel NULL (ver 0032).
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

  perform log_audit(p_tenant, 'credential.register', 'integration_credentials', v_id, null,
                    jsonb_build_object('kind', p_kind, 'provider', p_provider,
                                       'fingerprint', p_fingerprint, 'not_after', p_not_after,
                                       'finalidades', coalesce(p_finalidades, array['ingest_dfe','consulta_apuracao']),
                                       'uploaded_by_role', p_uploaded_by_role,
                                       'uploaded_on_behalf', coalesce(p_uploaded_on_behalf, false)));
  return v_id;
end $function$;

revoke all on function public.register_credential(uuid, text, credential_kind, text, text, text, text, date, date, text[], text[], text, boolean) from public, anon, authenticated;
grant execute on function public.register_credential(uuid, text, credential_kind, text, text, text, text, date, date, text[], text[], text, boolean) to service_role;

-- ─────────── credentials_status: o que a tela precisa mostrar ─────────────
drop function if exists public.credentials_status(uuid);
create or replace function public.credentials_status(p_tenant uuid)
returns table(id uuid, provider text, kind credential_kind, status credential_status,
              subject_cn text, subject_cnpj text, not_after date, dias_para_expirar integer,
              last_used_at timestamptz, last_error text, finalidades text[],
              falhas_consecutivas integer, uploaded_on_behalf boolean, uploaded_by_role text,
              uploaded_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select c.id, c.provider, c.kind, c.status, c.subject_cn, c.subject_cnpj, c.not_after,
         case when c.not_after is null then null else (c.not_after - current_date) end,
         c.last_used_at, c.last_error, c.finalidades, c.falhas_consecutivas,
         c.uploaded_on_behalf, c.uploaded_by_role, pr.full_name, c.created_at
  from integration_credentials c
  left join profiles pr on pr.user_id = c.created_by
  where c.tenant_id = p_tenant and c.status <> 'revogada'
  order by c.provider, c.kind;
end $function$;

revoke all on function public.credentials_status(uuid) from public, anon;
grant execute on function public.credentials_status(uuid) to authenticated, service_role;

revoke all on function public.finalidades_validas(text[]) from public, anon;
grant execute on function public.finalidades_validas(text[]) to authenticated, service_role;
