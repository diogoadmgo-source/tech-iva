-- 0030_fix_null_role_guards.sql
-- ESPELHO de migration aplicada diretamente no banco pelo administrador.
--
-- FALHA DE SEGURANÇA CORRIGIDA: guardas escritas como
--   if role_in(p_tenant) not in ('a','b') then raise exception 'forbidden'; end if;
-- NÃO disparam quando role_in() devolve NULL (usuário autenticado, porém SEM
-- membership no tenant alvo): em SQL, NULL NOT IN (...) = NULL e IF NULL não
-- executa o RAISE. Consequência: qualquer usuário recém-cadastrado podia chamar
-- channel_portfolio(qualquer_tenant) e receber nomes de empresas, CNPJs e
-- buracos de caixa.

create or replace function public.has_role(p_tenant uuid, p_roles member_role[])
returns boolean
language sql stable security definer
set search_path to 'public', 'extensions'
as $$
  select coalesce(role_in(p_tenant) = any(p_roles), false);
$$;

revoke all on function public.has_role(uuid, member_role[]) from public, anon, authenticated;

create or replace function public.channel_portfolio(p_tenant uuid, p_filters jsonb default '{}'::jsonb)
returns table(tenant_id uuid, name text, cnpj text, plan_code text,
              last_ingest timestamptz, gap_30_cents bigint, gap_90_cents bigint,
              open_alerts bigint, next_window date)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $$
begin
  if not has_role(p_tenant, array['platform_admin','platform_ops','channel_admin','channel_analyst']::member_role[]) then
    raise exception 'forbidden';
  end if;
  return query
  select t.id, t.name, t.cnpj,
         (select p.code from subscriptions s join plans p on p.id=s.plan_id where s.tenant_id=t.id order by s.started_at desc limit 1),
         (select max(j.finished_at) from jobs j where j.tenant_id=t.id and j.kind='ingest_dfe' and j.status='done'),
         coalesce((select sum(case e.kind when 'tax_out' then -e.amount_cents when 'credit_in' then e.amount_cents else 0 end)
                     from tax_cash_events e where e.tenant_id=t.id
                      and e.event_date between current_date and current_date+30),0)::bigint,
         coalesce((select sum(case e.kind when 'tax_out' then -e.amount_cents when 'credit_in' then e.amount_cents else 0 end)
                     from tax_cash_events e where e.tenant_id=t.id
                      and e.event_date between current_date and current_date+90),0)::bigint,
         (select count(*) from alerts a where a.tenant_id=t.id and a.resolved_at is null),
         (select r.next_window from regime_simulations r where r.tenant_id=t.id order by r.run_at desc limit 1)
  from tenants t
  where t.kind='company' and t.status='active'
    and t.path <@ (select path from tenants where id=p_tenant)
  order by 6 asc;
end $$;

create or replace function public.set_regime_manual(p_tenant uuid, p_party uuid, p_regime regime_kind, p_reason text)
returns void
language plpgsql security definer
set search_path to 'public', 'extensions'
as $$
declare v_old regime_kind;
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;
  select regime into v_old from counterparties where id=p_party and tenant_id=p_tenant;
  if v_old is null then raise exception 'not found'; end if;
  update counterparties set regime=p_regime, regime_source='manual', regime_checked_at=now()
   where id=p_party and tenant_id=p_tenant;
  perform log_audit(p_tenant,'counterparty.regime','counterparty',p_party::text,
                    jsonb_build_object('regime',v_old), jsonb_build_object('regime',p_regime,'reason',p_reason));
end $$;
