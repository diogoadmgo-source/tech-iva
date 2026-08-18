drop function if exists public.credentials_status(uuid);
create or replace function public.credentials_status(p_tenant uuid)
returns table(id uuid, provider text, kind credential_kind, status credential_status,
              subject_cn text, subject_cnpj text, not_before date, not_after date,
              dias_para_expirar integer, dias_de_validade integer,
              last_used_at timestamptz, last_used_finalidade text, last_error text,
              fingerprint text, finalidades text[],
              falhas_consecutivas integer, uploaded_on_behalf boolean, uploaded_by_role text,
              uploaded_by_name text, created_at timestamptz, titular_confere boolean)
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select c.id, c.provider, c.kind, c.status, c.subject_cn, c.subject_cnpj, c.not_before, c.not_after,
         case when c.not_after is null then null else (c.not_after - current_date) end,
         case when c.not_after is null or c.not_before is null then null
              else (c.not_after - c.not_before) end,
         c.last_used_at,
         (select u.finalidade from credential_usage u
           where u.credential_id = c.id order by u.usado_em desc limit 1),
         c.last_error, c.fingerprint, c.finalidades, c.falhas_consecutivas,
         c.uploaded_on_behalf, c.uploaded_by_role, pr.full_name, c.created_at,
         case when c.subject_cnpj is null then null
              else certificado_confere_titular(p_tenant, c.subject_cnpj) end
  from integration_credentials c
  left join profiles pr on pr.user_id = c.created_by
  where c.tenant_id = p_tenant and c.status <> 'revogada'
  order by c.provider, c.kind;
end $function$;
revoke all on function public.credentials_status(uuid) from public, anon;
grant execute on function public.credentials_status(uuid) to authenticated, service_role;