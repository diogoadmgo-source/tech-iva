-- 0211_conciliacao_documentos_page — paginação e ordenação no servidor
create index if not exists rtc_debito_tenant_comp_id
  on public.rtc_debito (tenant_id, competencia, id desc);

create or replace function public.conciliacao_documentos_page(
  p_tenant uuid,
  p_competencia date,
  p_so_divergentes boolean default true,
  p_order text default 'diferenca',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null
)
returns table (
  debito_id bigint,
  chave_dfe text,
  numero_dfe text,
  contraparte text,
  receita_cents bigint,
  nosso_cents bigint,
  diferenca_cents bigint,
  nao_extinto_cents bigint,
  situacao debito_situacao,
  grupo apuracao_grupo,
  total_count bigint
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_order text := lower(coalesce(p_order, 'diferenca'));
  v_desc  boolean := lower(coalesce(p_dir, 'desc')) <> 'asc';
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_off   integer := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  if v_order not in ('diferenca','receita','nosso','nao_extinto','numero') then
    v_order := 'diferenca';
  end if;

  return query
  with base as (
    select d.id,
           d.chave_dfe,
           d.numero_dfe,
           coalesce(c.name, d.ni_adquirente) as contraparte,
           d.cbs_total_cents as receita_cents,
           coalesce(i.cbs_cents, 0)::bigint as nosso_cents,
           (d.cbs_total_cents - coalesce(i.cbs_cents, 0))::bigint as diferenca_cents,
           d.cbs_nao_extinto_cents as nao_extinto_cents,
           d.situacao,
           d.grupo
    from rtc_debito d
    left join invoices i
      on i.tenant_id = d.tenant_id and i.access_key = d.chave_dfe
    left join counterparties c on c.id = i.counterparty_id
    where d.tenant_id = p_tenant
      and d.competencia = date_trunc('month', p_competencia)::date
      and (not p_so_divergentes
           or i.id is null
           or d.cbs_total_cents <> coalesce(i.cbs_cents, 0))
      and (v_q is null
           or d.numero_dfe ilike '%' || v_q || '%'
           or d.chave_dfe ilike '%' || v_q || '%'
           or coalesce(c.name, d.ni_adquirente) ilike '%' || v_q || '%')
  ), counted as (
    select base.*, count(*) over () as total_count from base
  )
  select counted.id, counted.chave_dfe, counted.numero_dfe, counted.contraparte,
         counted.receita_cents, counted.nosso_cents, counted.diferenca_cents,
         counted.nao_extinto_cents, counted.situacao, counted.grupo,
         counted.total_count
  from counted
  order by
    -- ordenação estável: chave escolhida + desempate por id
    case when v_desc then
      case v_order
        when 'diferenca'   then abs(counted.diferenca_cents)
        when 'receita'     then counted.receita_cents
        when 'nosso'       then counted.nosso_cents
        when 'nao_extinto' then counted.nao_extinto_cents
        else null
      end
    end desc nulls last,
    case when not v_desc then
      case v_order
        when 'diferenca'   then abs(counted.diferenca_cents)
        when 'receita'     then counted.receita_cents
        when 'nosso'       then counted.nosso_cents
        when 'nao_extinto' then counted.nao_extinto_cents
        else null
      end
    end asc nulls last,
    case when v_order = 'numero' and v_desc then counted.numero_dfe end desc nulls last,
    case when v_order = 'numero' and not v_desc then counted.numero_dfe end asc nulls last,
    counted.id desc
  limit v_limit offset v_off;
end $$;

revoke all on function public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text) from public;
grant execute on function public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text) to authenticated;
grant execute on function public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text) to service_role;