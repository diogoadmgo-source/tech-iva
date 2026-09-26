-- 0232_conciliacao_ausente_nao_e_zero.sql
--
-- As duas funções de conciliação devolviam coalesce(i.cbs_cents, 0). Nota da
-- Receita SEM correspondente aqui, e nota nossa AINDA NÃO CALCULADA, chegavam
-- ambas como "nosso cálculo = 0" — indistinguíveis de uma nota imune. A tela não
-- tinha como mostrar a verdade porque o zero nascia aqui.
--
-- Agora: nosso_cents e diferenca_cents são NULOS quando não há valor, e a coluna
-- nova tem_correspondente diz se existe nota nossa com a mesma chave.
--
-- A lista de colunas devolvida muda, então é drop + create (senão SQLSTATE
-- 42P13). O drop apaga as permissões: reemitidas iguais às de antes
-- (authenticated, service_role — conferido em 23/09).
--
-- Filtro "só divergentes": passa a incluir também a nota nossa sem cálculo.
-- Ordenação por diferença: quem não tem diferença calculável ordena pelo valor
-- da Receita, como antes (antes a diferença delas era o valor inteiro).

drop function if exists public.conciliacao_documentos(uuid, date, boolean);

create function public.conciliacao_documentos(
  p_tenant uuid, p_competencia date, p_so_divergentes boolean default true)
returns table(chave_dfe text, numero_dfe text, contraparte text, receita_cents bigint,
              nosso_cents bigint, diferenca_cents bigint, nao_extinto_cents bigint,
              situacao debito_situacao, grupo apuracao_grupo, tem_correspondente boolean)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select d.chave_dfe, d.numero_dfe,
         coalesce(c.name, d.ni_adquirente) as contraparte,
         d.cbs_total_cents,
         i.cbs_cents,
         (d.cbs_total_cents - i.cbs_cents)::bigint,
         d.cbs_nao_extinto_cents,
         d.situacao, d.grupo,
         (i.id is not null)
  from rtc_debito d
  left join invoices i on i.tenant_id = d.tenant_id and i.access_key = d.chave_dfe
  left join counterparties c on c.id = i.counterparty_id
  where d.tenant_id = p_tenant
    and d.competencia = date_trunc('month', p_competencia)::date
    and (not p_so_divergentes
         or i.id is null                        -- a Receita tem, nós não
         or i.cbs_cents is null                 -- temos a nota, sem cálculo
         or d.cbs_total_cents <> i.cbs_cents)   -- valor divergente
  order by abs(coalesce(d.cbs_total_cents - i.cbs_cents, d.cbs_total_cents)) desc nulls last;
end $function$;

revoke all on function public.conciliacao_documentos(uuid, date, boolean) from public, anon;
grant execute on function public.conciliacao_documentos(uuid, date, boolean) to authenticated, service_role;

drop function if exists public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text);

create function public.conciliacao_documentos_page(
  p_tenant uuid, p_competencia date, p_so_divergentes boolean default true,
  p_order text default 'diferenca', p_dir text default 'desc',
  p_limit integer default 50, p_offset integer default 0, p_search text default null)
returns table(debito_id bigint, chave_dfe text, numero_dfe text, contraparte text,
              receita_cents bigint, nosso_cents bigint, diferenca_cents bigint,
              nao_extinto_cents bigint, situacao debito_situacao, grupo apuracao_grupo,
              total_count bigint, tem_correspondente boolean)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $function$
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
           i.cbs_cents::bigint as nosso_cents,
           (d.cbs_total_cents - i.cbs_cents)::bigint as diferenca_cents,
           d.cbs_nao_extinto_cents as nao_extinto_cents,
           d.situacao,
           d.grupo,
           (i.id is not null) as tem_correspondente
    from rtc_debito d
    left join invoices i
      on i.tenant_id = d.tenant_id and i.access_key = d.chave_dfe
    left join counterparties c on c.id = i.counterparty_id
    where d.tenant_id = p_tenant
      and d.competencia = date_trunc('month', p_competencia)::date
      and (not p_so_divergentes
           or i.id is null
           or i.cbs_cents is null
           or d.cbs_total_cents <> i.cbs_cents)
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
         counted.total_count, counted.tem_correspondente
  from counted
  order by
    -- ordenação estável: chave escolhida + desempate por id. Sem diferença
    -- calculável, ordena pelo valor da Receita, como antes.
    case when v_desc then
      case v_order
        when 'diferenca'   then abs(coalesce(counted.diferenca_cents, counted.receita_cents))
        when 'receita'     then counted.receita_cents
        when 'nosso'       then counted.nosso_cents
        when 'nao_extinto' then counted.nao_extinto_cents
        else null
      end
    end desc nulls last,
    case when not v_desc then
      case v_order
        when 'diferenca'   then abs(coalesce(counted.diferenca_cents, counted.receita_cents))
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
end $function$;

revoke all on function public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text) from public, anon;
grant execute on function public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text) to authenticated, service_role;
