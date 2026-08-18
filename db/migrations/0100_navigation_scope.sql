-- 0100_navigation_scope.sql
-- Espelho da migration aplicada em produção (não reaplicar cegamente).
--
-- Defeito corrigido: a navegação (seletor de tenant / TenantSwitcher) listava
-- apenas tenants com MEMBERSHIP DIRETA. O platform_admin só tem vínculo no
-- tenant raiz, então nunca conseguia abrir /cash, /chain, /price, /simulador de
-- uma empresa; o mesmo valia para channel_admin em relação à carteira.
-- Nunca foi problema de permissão: RLS e RPCs sempre permitiram (in_scope
-- cobre descendentes). Faltava o caminho na navegação.

-- Todo o escopo hierárquico do usuário, em árvore, com papel efetivo e a marca
-- de quem é vínculo direto vs. acesso por hierarquia.
create or replace function public.my_tenants()
returns table (
  id uuid,
  parent_id uuid,
  name text,
  kind tenant_kind,
  cnpj text,
  slug extensions.citext,
  level smallint,
  path text,
  status tenant_status,
  papel member_role,
  membership_direta boolean,
  credito_habilitado boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  return query
  select t.id, t.parent_id, t.name, t.kind, t.cnpj, t.slug, t.level, t.path::text, t.status,
         role_in(t.id) as papel,
         exists (select 1 from memberships m where m.user_id = auth.uid() and m.tenant_id = t.id) as membership_direta,
         feature_enabled(t.id, 'credit') as credito_habilitado
  from tenants t
  where t.path <@ any (auth_scopes())
    and t.status = 'active'
  order by t.path;
end $function$;

-- Contexto do tenant aberto: papel efetivo, trilha de ancestrais, marca e o
-- sinalizador "visitando" (acesso por hierarquia). O escopo continua trancado:
-- in_scope() barra abrir contexto fora do escopo.
create or replace function public.tenant_context(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
declare v tenants; v_papel member_role; v_ancestrais jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select * into v from tenants where id = p_tenant;
  v_papel := role_in(p_tenant);

  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind)
                            order by a.level), '[]'::jsonb)
    into v_ancestrais
  from tenants a where v.path <@ a.path and a.id <> v.id;

  return jsonb_build_object(
    'id', v.id, 'name', v.name, 'kind', v.kind, 'cnpj', v.cnpj, 'level', v.level,
    'papel', v_papel,
    'membership_direta', exists (select 1 from memberships m where m.user_id=auth.uid() and m.tenant_id=v.id),
    -- quem chega por hierarquia está VISITANDO: o front deve deixar isso visível,
    -- para ninguém achar que está no próprio contexto e agir sem perceber.
    'visitando', not exists (select 1 from memberships m where m.user_id=auth.uid() and m.tenant_id=v.id),
    'ancestrais', v_ancestrais,
    'filhos', (select count(*) from tenants c where c.parent_id = v.id and c.status='active'),
    'credito_habilitado', feature_enabled(v.id,'credit'),
    'marca', coalesce((select a.brand from tenants a
                        where v.path <@ a.path and a.kind='channel'
                        order by a.level desc limit 1), '{}'::jsonb)
  );
end $function$;

grant execute on function public.my_tenants() to authenticated;
grant execute on function public.tenant_context(uuid) to authenticated;
