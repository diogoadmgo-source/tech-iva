-- 0035_chain_map_semaphore_action_coherence.sql
create or replace function public.chain_map(p_tenant uuid, p_role party_role default 'customer'::party_role, p_filters jsonb default '{}'::jsonb)
returns table(id uuid, cnpj text, name text, regime regime_kind, credit_transfer_pct numeric,
              share_pct numeric, total_cents bigint, credit_lost_cents bigint,
              semaphore text, suggested_action text)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $$
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
  ), tot as (select nullif(sum(b_total),0) as s from base),
  calc as (
    select b.*,
           round(100.0 * b.b_total / coalesce((select s from tot),1), 2) as b_share,
           (p_role='customer' and b.b_regime in ('real','presumido'))
             or (p_role='supplier' and b.b_regime in ('simples','mei','pf')) as b_risky
    from base b
  ), sem as (
    select c.*,
           case
             when c.b_regime = 'desconhecido' then 'warn'
             when c.b_risky and c.b_share > 10 then 'crit'
             when c.b_risky and c.b_share > 3  then 'warn'
             else 'ok'
           end as b_sem
    from calc c
  )
  select s.b_id, s.b_cnpj, s.b_name, s.b_regime, s.b_ctp, s.b_share, s.b_total,
         (s.b_total * (100 - coalesce(s.b_ctp,0)) / 100)::bigint,
         s.b_sem,
         case
           when s.b_regime = 'desconhecido' then 'Classificar'
           when s.b_sem = 'ok' then 'Manter'
           when p_role='customer' then
             case when s.b_sem='crit' then 'Atenção: exige crédito integral'
                  else 'Monitorar: exige crédito integral' end
           else
             case when s.b_sem='crit' then 'Avaliar troca'
                  else 'Monitorar fornecedor sem crédito' end
         end
  from sem s
  order by s.b_total desc;
end $$;