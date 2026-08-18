-- Migration 20260817213338 (0022_fix_chain_map_ambiguity) — exportada de supabase_migrations.schema_migrations
-- Bug meu no 0013: os OUT params (total_cents, credit_transfer_pct...) colidiam com
-- colunas homônimas dentro da CTE. Qualifico tudo e renomeio os internos.
create or replace function chain_map(p_tenant uuid, p_role party_role default 'customer', p_filters jsonb default '{}')
returns table (id uuid, cnpj text, name text, regime regime_kind, credit_transfer_pct numeric,
               share_pct numeric, total_cents bigint, credit_lost_cents bigint, semaphore text, suggested_action text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_dir invoice_direction := case when p_role='supplier' then 'in' else 'out' end;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  with base as (
    select c.id as b_id, c.cnpj as b_cnpj, c.name as b_name, c.regime as b_regime,
           c.credit_transfer_pct as b_ctp,
           coalesce(sum(i.total_cents),0)::bigint as b_total,
           coalesce(sum(i.credit_cents),0)::bigint as b_credit
    from counterparties c
    left join invoices i on i.counterparty_id = c.id and i.tenant_id = c.tenant_id
                        and i.direction = v_dir and i.issued_at >= current_date - 365
    where c.tenant_id = p_tenant and (c.role = p_role or c.role = 'both')
    group by 1,2,3,4,5
  ), tot as (select nullif(sum(b_total),0) as s from base)
  select b.b_id, b.b_cnpj, b.b_name, b.b_regime, b.b_ctp,
         round(100.0 * b.b_total / coalesce((select s from tot),1), 2),
         b.b_total,
         (b.b_total * (100 - coalesce(b.b_ctp,0)) / 100)::bigint,
         case
           when b.b_regime = 'desconhecido' then 'warn'
           when p_role='customer' and b.b_regime in ('real','presumido')
                and round(100.0*b.b_total/coalesce((select s from tot),1),2) > 10 then 'crit'
           when p_role='supplier' and b.b_regime in ('simples','mei','pf')
                and round(100.0*b.b_total/coalesce((select s from tot),1),2) > 10 then 'crit'
           else 'ok' end,
         case
           when b.b_regime = 'desconhecido' then 'Classificar'
           when p_role='customer' and b.b_regime in ('real','presumido') then 'Atenção: exige crédito integral'
           when p_role='supplier' and b.b_regime in ('simples','mei','pf') then 'Avaliar troca'
           else 'Manter' end
  from base b
  order by b.b_total desc;
end $$;
