-- Migration 20260818003537 (0100_my_tenants_navigation) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- DEFEITO DE NAVEGAÇÃO: quem está no topo não consegue entrar nas empresas
-- ============================================================================
-- O seletor de tenant listava apenas os tenants com MEMBERSHIP DIRETA. Como o
-- platform_admin só tem membership no tenant raiz, ele nunca conseguia abrir as
-- telas de uma empresa — via só o painel da plataforma. O mesmo valia para o
-- channel_admin em relação às empresas da carteira dele.
--
-- Isso nunca foi um problema de permissão: a RLS e as RPCs sempre permitiram
-- (in_scope cobre os descendentes). Era só a navegação que não oferecia o caminho.
-- Corrigido aqui: o seletor passa a listar TODO o escopo, em árvore.

create or replace function my_tenants()
returns table (
  id uuid, parent_id uuid, name text, kind tenant_kind, cnpj text, slug citext,
  level smallint, path text, status tenant_status,
  papel member_role,          -- papel efetivo (herdado do ancestral mais próximo)
  membership_direta boolean,  -- true = escolhi este; false = alcanço por hierarquia
  credito_habilitado boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
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
end $$;
grant execute on function my_tenants() to authenticated;

-- Contexto do tenant aberto: o front usa para montar o menu e a trilha de navegação.
create or replace function tenant_context(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
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
end $$;
grant execute on function tenant_context(uuid) to authenticated;
