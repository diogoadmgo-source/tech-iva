-- Migration 20260818004126 (0110_bulk_calc_engine) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- MOTOR DE CÁLCULO EM LOTE — reescrita para volume (100 mil notas +)
-- ============================================================================
-- DOIS BUGS GRAVES encontrados no teste de carga, ambos SILENCIOSOS:
--   1. compute_taxes tinha .limit(20000): com 225 mil itens, 90% nunca eram
--      calculados e ninguém percebia — os números simplesmente ficavam errados.
--   2. project_cash lia recebíveis sem paginação: o PostgREST corta em 1000 linhas
--      por padrão, então com 75 mil recebíveis a projeção usava 1,3% dos dados.
-- Erro que aparece é bug; erro que não aparece é armadilha. Estes eram armadilhas.
--
-- CAUSA RAIZ: o worker fazia uma chamada HTTP por linha. 225 mil itens = 225 mil
-- idas e voltas (~75 minutos). A correção não é "otimizar o loop", é NÃO TER LOOP:
-- a calculadora é consultada uma vez por ASSINATURA FISCAL distinta (algumas
-- centenas), e a regra resultante é aplicada a todas as linhas de uma vez em SQL.

-- ------------------------------------------------------- cache de regra fiscal
-- Assinatura = o que determina a tributação, SEM o valor. Dois itens de R$ 10 e
-- R$ 10.000 com mesmo CST, cClassTrib, NCM, origem, destino e ano seguem a MESMA
-- regra; só a base muda. Por isso o cache é por regra, não por item.
create table calc_rule_cache (
  rule_version   text not null,
  cst            text not null,
  cclasstrib     text not null,
  classificacao  text not null default '',   -- NCM ou NBS
  uf_origem      text not null default '',
  uf_destino     text not null default '',
  municipio      text not null default '',
  ano            int  not null,
  aliq_ibs_uf    numeric(9,6) not null default 0,
  aliq_ibs_mun   numeric(9,6) not null default 0,
  aliq_cbs       numeric(9,6) not null default 0,
  aliq_is        numeric(9,6) not null default 0,
  reducao_pct    numeric(6,3) not null default 0,
  permite_credito boolean not null default true,
  memoria        jsonb,
  base_legal     text,
  calculado_em   timestamptz not null default now(),
  primary key (rule_version, cst, cclasstrib, classificacao, uf_origem, uf_destino, municipio, ano)
);
alter table calc_rule_cache enable row level security;
create policy calc_rule_select on calc_rule_cache for select to authenticated using (true);
grant select on calc_rule_cache to authenticated;
grant all on calc_rule_cache to service_role;

-- Quais assinaturas ainda não têm regra calculada? O worker consulta a calculadora
-- SÓ para estas — tipicamente centenas, não centenas de milhares.
create or replace function pending_calc_signatures(p_tenant uuid, p_rule_version text, p_limit int default 2000)
returns table (cst text, cclasstrib text, classificacao text, uf_origem text, uf_destino text,
               municipio text, ano int, itens bigint)
language plpgsql stable security definer set search_path = public, extensions as $$
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
  group by 1,2,3,4,5,6,7
  order by 8 desc
  limit p_limit;
end $$;
revoke execute on function pending_calc_signatures(uuid,text,int) from public, anon, authenticated;
grant execute on function pending_calc_signatures(uuid,text,int) to service_role;

create or replace function calc_rule_cache_upsert(p jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int := 0; r jsonb;
begin
  for r in select * from jsonb_array_elements(p) loop
    insert into calc_rule_cache (rule_version, cst, cclasstrib, classificacao, uf_origem, uf_destino,
      municipio, ano, aliq_ibs_uf, aliq_ibs_mun, aliq_cbs, aliq_is, reducao_pct, permite_credito,
      memoria, base_legal)
    values (r->>'rule_version', coalesce(r->>'cst',''), coalesce(r->>'cclasstrib',''),
      coalesce(r->>'classificacao',''), coalesce(r->>'uf_origem',''), coalesce(r->>'uf_destino',''),
      coalesce(r->>'municipio',''), (r->>'ano')::int,
      coalesce((r->>'aliq_ibs_uf')::numeric,0), coalesce((r->>'aliq_ibs_mun')::numeric,0),
      coalesce((r->>'aliq_cbs')::numeric,0), coalesce((r->>'aliq_is')::numeric,0),
      coalesce((r->>'reducao_pct')::numeric,0), coalesce((r->>'permite_credito')::boolean,true),
      r->'memoria', r->>'base_legal')
    on conflict (rule_version, cst, cclasstrib, classificacao, uf_origem, uf_destino, municipio, ano)
    do update set aliq_ibs_uf=excluded.aliq_ibs_uf, aliq_ibs_mun=excluded.aliq_ibs_mun,
      aliq_cbs=excluded.aliq_cbs, aliq_is=excluded.aliq_is, reducao_pct=excluded.reducao_pct,
      permite_credito=excluded.permite_credito, memoria=excluded.memoria,
      base_legal=excluded.base_legal, calculado_em=now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function calc_rule_cache_upsert(jsonb) from public, anon, authenticated;
grant execute on function calc_rule_cache_upsert(jsonb) to service_role;

-- APLICAÇÃO EM LOTE: uma única instrução para todos os itens. Sem loop, sem
-- round-trip por linha. Processa em blocos para não segurar lock demais.
create or replace function apply_calc_rules(p_tenant uuid, p_rule_version text, p_batch int default 50000)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_rule_id uuid; v_atualizados bigint := 0; v_sem_regra bigint; v_lote bigint;
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

  -- consolida os totais no cabeçalho da nota (também em lote)
  update invoices i set
    ibs_cents = s.ibs, cbs_cents = s.cbs, is_cents = s.is_, credit_cents = s.cred,
    rule_version_id = coalesce(v_rule_id, i.rule_version_id)
  from (select invoice_id, sum(ibs_cents) ibs, sum(cbs_cents) cbs,
               sum(is_cents) is_, sum(credit_cents) cred
        from invoice_items where tenant_id = p_tenant group by invoice_id) s
  where i.id = s.invoice_id and i.tenant_id = p_tenant;

  select count(*) into v_sem_regra
  from invoice_items it
  where it.tenant_id = p_tenant
    and (it.calc_memory is null or it.calc_memory->>'rule_version' is distinct from p_rule_version);

  return jsonb_build_object('itens_atualizados', v_atualizados,
                            'itens_sem_regra', v_sem_regra,
                            'rule_version', p_rule_version);
end $$;
revoke execute on function apply_calc_rules(uuid,text,int) from public, anon, authenticated;
grant execute on function apply_calc_rules(uuid,text,int) to service_role;
