-- Aprendido no primeiro cálculo real contra o motor oficial (1.3.0-dbV0042, 19/08/2026):
--  1) CBS/IBS só existem para fatos geradores a partir de 01/01/2026 (LC 214/2025). O motor
--     responde 404 "CST não encontrada para a data 2025-..." para notas de 2025. Essas notas não
--     devem nem entrar na fila de cálculo nem contar como "sem regra".
--  2) O seed da Distribuidora Beta usava NCM 34022000 (extinto na NCM 2022). Corrigido para
--     3402.31.00 (detergentes — preparações orgânicas tensoativas).

create or replace function public.premissa_inicio_vigencia() returns date
language sql immutable as $$ select date '2026-01-01' $$;
comment on function public.premissa_inicio_vigencia() is
  'Primeiro dia com destaque de CBS/IBS (LC 214/2025 art. 1º e transição). Notas anteriores não passam pela Calculadora.';

create or replace function public.pending_calc_signatures(p_tenant uuid, p_rule_version text, p_limit integer default 2000)
returns table(cst text, cclasstrib text, classificacao text, uf_origem text, uf_destino text, municipio text, ano integer, itens bigint)
language plpgsql stable security definer set search_path to 'public','extensions' as $function$
begin
  return query
  select coalesce(it.cst,'') , coalesce(it.cclasstrib,''), coalesce(it.ncm,''),
         coalesce(t.uf_origem,''), coalesce(t.uf_destino,''), coalesce(t.municipio,''),
         extract(year from i.issued_at)::int, count(*)
  from invoice_items it
  join invoices i on i.id = it.invoice_id
  cross join lateral (select ''::text uf_origem, ''::text uf_destino, ''::text municipio) t
  left join calc_rule_cache c
    on c.rule_version = p_rule_version
   and c.cst = coalesce(it.cst,'') and c.cclasstrib = coalesce(it.cclasstrib,'')
   and c.classificacao = coalesce(it.ncm,'')
   and c.uf_origem = '' and c.uf_destino = '' and c.municipio = ''
   and c.ano = extract(year from i.issued_at)::int
  where it.tenant_id = p_tenant and c.cst is null
    and i.issued_at >= premissa_inicio_vigencia()          -- (1)
  group by 1,2,3,4,5,6,7
  order by 8 desc
  limit p_limit;
end $function$;

-- apply_calc_rules: "sem regra" só conta fatos geradores dentro da vigência
create or replace function public.apply_calc_rules(p_tenant uuid, p_rule_version text, p_batch integer default 50000)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $function$
declare v_rule_id uuid; v_atualizados bigint := 0; v_sem_regra bigint; v_fora_vigencia bigint; v_lote bigint;
begin
  select id into v_rule_id from rule_versions where calc_version = p_rule_version order by valid_from desc limit 1;

  loop
    with alvo as (
      select it.id, it.base_cents, c.aliq_ibs_uf, c.aliq_ibs_mun, c.aliq_cbs, c.aliq_is,
             c.reducao_pct, c.permite_credito, c.memoria, i.direction
      from invoice_items it
      join invoices i on i.id = it.invoice_id
      join calc_rule_cache c
        on c.rule_version = p_rule_version
       and c.cst = coalesce(it.cst,'') and c.cclasstrib = coalesce(it.cclasstrib,'')
       and c.classificacao = coalesce(it.ncm,'')
       and c.uf_origem = '' and c.uf_destino = '' and c.municipio = ''
       and c.ano = extract(year from i.issued_at)::int
      where it.tenant_id = p_tenant
        and i.issued_at >= premissa_inicio_vigencia()
        and (it.calc_memory is null or it.calc_memory->>'rule_version' is distinct from p_rule_version)
      limit p_batch
      for update of it skip locked
    )
    update invoice_items x set
      ibs_cents = ((a.base_cents * (a.aliq_ibs_uf + a.aliq_ibs_mun)) * (1 - a.reducao_pct/100))::bigint,
      cbs_cents = ((a.base_cents * a.aliq_cbs) * (1 - a.reducao_pct/100))::bigint,
      is_cents  = (a.base_cents * a.aliq_is)::bigint,
      credit_eligible = (a.direction = 'in' and a.permite_credito),
      credit_cents = case when a.direction = 'in' and a.permite_credito
        then ((a.base_cents * (a.aliq_ibs_uf + a.aliq_ibs_mun + a.aliq_cbs)) * (1 - a.reducao_pct/100))::bigint
        else 0 end,
      calc_memory = coalesce(a.memoria,'{}'::jsonb) || jsonb_build_object('rule_version', p_rule_version)
    from alvo a where x.id = a.id;

    get diagnostics v_lote = row_count;
    v_atualizados := v_atualizados + v_lote;
    exit when v_lote = 0;
  end loop;

  update invoices i set
    ibs_cents = s.ibs, cbs_cents = s.cbs, is_cents = s.is_, credit_cents = s.cred,
    rule_version_id = coalesce(v_rule_id, i.rule_version_id)
  from (select invoice_id, sum(ibs_cents) ibs, sum(cbs_cents) cbs,
               sum(is_cents) is_, sum(credit_cents) cred
        from invoice_items where tenant_id = p_tenant group by invoice_id) s
  where i.id = s.invoice_id and i.tenant_id = p_tenant;

  select count(*) filter (where i.issued_at >= premissa_inicio_vigencia()),
         count(*) filter (where i.issued_at <  premissa_inicio_vigencia())
    into v_sem_regra, v_fora_vigencia
  from invoice_items it join invoices i on i.id = it.invoice_id
  where it.tenant_id = p_tenant
    and (it.calc_memory is null or it.calc_memory->>'rule_version' is distinct from p_rule_version);

  return jsonb_build_object('itens_atualizados', v_atualizados,
                            'itens_sem_regra', v_sem_regra,
                            'itens_fora_vigencia', v_fora_vigencia,
                            'rule_version', p_rule_version);
end $function$;

-- (2) seed: NCM extinto → vigente
update invoice_items set ncm = '34023100' where ncm = '34022000'
  and tenant_id in (select id from tenants where name in ('Distribuidora Beta','Serviços Gama','Contábil Alfa'));
update products set ncm = '34023100' where ncm = '34022000';
