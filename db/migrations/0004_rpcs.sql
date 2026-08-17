-- 0004_rpcs.sql
-- Bloco 1.5 do documento 01 — convites, papéis, ciclo de vida.
-- Nota: os corpos chamam log_audit(), criada em 0005 (plpgsql resolve em tempo de execução).
-- Decisão gravada: enforce_mfa() no início das RPCs sensíveis (erro 'MFA required').

-- Convidar (gera token; o e-mail é enviado por server function que lê o token retornado)
create or replace function invite_user(p_tenant uuid, p_email citext, p_role member_role)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(gen_random_bytes(24),'hex'); v_id uuid;
begin
  if not can_admin(p_tenant) then raise exception 'forbidden'; end if;
  perform enforce_mfa(p_tenant);
  -- papel compatível com o tipo do tenant
  if (select kind from tenants where id=p_tenant)='platform' and p_role::text not like 'platform%' then raise exception 'invalid role for platform'; end if;
  if (select kind from tenants where id=p_tenant)='channel'  and p_role::text not like 'channel%'  then raise exception 'invalid role for channel'; end if;
  if (select kind from tenants where id=p_tenant) in ('company','unit') and p_role not in ('owner','finance','commercial','viewer') then raise exception 'invalid role for company'; end if;

  insert into invitations (tenant_id,email,role,token_hash,invited_by)
  values (p_tenant,p_email,p_role,encode(digest(v_token,'sha256'),'hex'),auth.uid())
  returning id into v_id;
  perform log_audit(p_tenant,'invitation.create','invitation',v_id::text,null,jsonb_build_object('email',p_email,'role',p_role));
  return query select v_id, v_token;
end $$;

-- Aceitar (usuário já logado com o mesmo e-mail)
create or replace function accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v invitations; v_email citext;
begin
  select * into v from invitations where token_hash = encode(digest(p_token,'sha256'),'hex') and status='pending' and expires_at>now();
  if v is null then raise exception 'invalid or expired invitation'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email <> v.email then raise exception 'invitation email mismatch'; end if;
  insert into memberships (user_id,tenant_id,role,created_by) values (auth.uid(),v.tenant_id,v.role,v.invited_by)
    on conflict (user_id,tenant_id) do update set role = excluded.role;
  update invitations set status='accepted', accepted_by=auth.uid(), accepted_at=now() where id=v.id;
  perform log_audit(v.tenant_id,'invitation.accept','membership',auth.uid()::text,null,jsonb_build_object('role',v.role));
  return v.tenant_id;
end $$;

-- Alterar papel / remover membro
create or replace function set_member_role(p_tenant uuid, p_user uuid, p_role member_role) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_old member_role;
begin
  if not can_admin(p_tenant) then raise exception 'forbidden'; end if;
  perform enforce_mfa(p_tenant);
  select role into v_old from memberships where tenant_id=p_tenant and user_id=p_user;
  update memberships set role=p_role where tenant_id=p_tenant and user_id=p_user;
  perform log_audit(p_tenant,'membership.role','membership',p_user::text,jsonb_build_object('role',v_old),jsonb_build_object('role',p_role));
end $$;

create or replace function remove_member(p_tenant uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not can_admin(p_tenant) then raise exception 'forbidden'; end if;
  if (select count(*) from memberships where tenant_id=p_tenant and role in ('owner','channel_admin','platform_admin')) = 1
     and (select role from memberships where tenant_id=p_tenant and user_id=p_user) in ('owner','channel_admin','platform_admin') then
    raise exception 'cannot remove last admin';
  end if;
  delete from memberships where tenant_id=p_tenant and user_id=p_user;
  perform log_audit(p_tenant,'membership.remove','membership',p_user::text,null,null);
end $$;

-- Criar tenant filho (empresa, unidade, canal) — única forma via cliente
create or replace function create_tenant(p_parent uuid, p_kind tenant_kind, p_name text, p_cnpj text default null, p_slug text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_parent_kind tenant_kind;
begin
  if not can_admin(p_parent) then raise exception 'forbidden'; end if;
  perform enforce_mfa(p_parent);
  select kind into v_parent_kind from tenants where id=p_parent;
  -- regras de composição
  if p_kind='platform' then raise exception 'cannot create platform'; end if;
  if p_kind='unit' and v_parent_kind<>'company' then raise exception 'unit must be under company'; end if;
  if p_kind='company' and v_parent_kind not in ('platform','channel') then raise exception 'company must be under platform or channel'; end if;
  if p_kind='channel' and v_parent_kind not in ('platform','channel') then raise exception 'channel must be under platform or channel'; end if;
  insert into tenants (parent_id,kind,name,cnpj,slug,created_by) values (p_parent,p_kind,p_name,p_cnpj,p_slug,auth.uid()) returning id into v_id;
  -- quem cria uma company vira owner dela (se for usuário do canal, mantém acesso por herança)
  if p_kind='company' and role_in(p_parent) in ('owner') then
    insert into memberships (user_id,tenant_id,role,created_by) values (auth.uid(),v_id,'owner',auth.uid());
  end if;
  perform log_audit(v_id,'tenant.create','tenant',v_id::text,null,jsonb_build_object('kind',p_kind,'name',p_name,'cnpj',p_cnpj,'parent',p_parent));
  return v_id;
end $$;

-- Mover subárvore (só platform)
create or replace function move_tenant(p_tenant uuid, p_new_parent uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_old ltree; v_new_parent ltree;
begin
  if not is_platform() then raise exception 'forbidden'; end if;
  perform enforce_mfa(p_tenant);
  select path into v_old from tenants where id=p_tenant;
  select path into v_new_parent from tenants where id=p_new_parent;
  if v_new_parent <@ v_old then raise exception 'cannot move under own descendant'; end if;
  alter table tenants disable trigger trg_tenants_reparent;
  update tenants set parent_id = p_new_parent where id = p_tenant;
  update tenants set path = v_new_parent || subpath(path, nlevel(v_old)-1), level = nlevel(v_new_parent || subpath(path, nlevel(v_old)-1)) - 1
   where path <@ v_old;
  alter table tenants enable trigger trg_tenants_reparent;
  perform log_audit(p_tenant,'tenant.move','tenant',p_tenant::text,jsonb_build_object('path',v_old::text),jsonb_build_object('parent',p_new_parent));
end $$;

grant execute on function invite_user(uuid,citext,member_role), accept_invitation(text),
  set_member_role(uuid,uuid,member_role), remove_member(uuid,uuid),
  create_tenant(uuid,tenant_kind,text,text,text), move_tenant(uuid,uuid) to authenticated;
