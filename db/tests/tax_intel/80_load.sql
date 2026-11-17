-- Carga: base sintética de :load_rows linhas (padrão 70.000) enviada em lotes de
-- 1.000 pelo mesmo RPC que a tela usa, como owner da Empresa A, e finalizada.
-- Os CNPJs são GERADOS (DV calculado) e não correspondem a consulta real nenhuma:
-- servem só para medir o banco. Os tempos saem como NOTICE "TEMPO".
--
-- Composição a cada 100 linhas: 1 CNPJ com DV errado (i % 100 = 50) e 1 repetição
-- da linha anterior (i % 100 = 1, i > 1). Uma em cada 5 é filial (ordem 0002).
select set_config('t.suite', 'carga', false);
select set_config('t.load_rows', :'load_rows', false);

create table t.timings (step text, ms numeric, rows int);
grant insert, select on t.timings to authenticated;

select t.claims(t.id('owner@co_a'));
set role authenticated;

select count(*) as rel_before from public.tax_relationships where tenant_id = t.id('co_a') \gset

do $$
declare
  n int := current_setting('t.load_rows')::int;
  v_imp uuid;
  v_batch jsonb;
  t0 timestamptz;
  t_all timestamptz := clock_timestamp();
  v_ms numeric;
  v_max numeric := 0;
  v_sum numeric := 0;
  v_res jsonb;
  b int;
begin
  t0 := clock_timestamp();
  v_imp := (public.tax_import_create(t.id('co_a'), 'carga.csv', 5000000, repeat('c', 64), 'csv',
            null, n, 'cliente', 2) ->> 'import_id')::uuid;
  insert into t.timings values ('create', extract(epoch from clock_timestamp() - t0) * 1000, 0);
  perform set_config('t.load_imp', v_imp::text, false);

  for b in 0 .. (n - 1) / 1000 loop
    select jsonb_agg(jsonb_build_object(
             'r', s.i,
             'cnpj', case when s.i % 100 = 50
                          then left(g.c, 13) || ((right(g.c, 1)::int + 1) % 10)::text
                          else g.c end,
             'razao', 'Empresa sintética ' || s.k,
             'rel', case when s.k % 3 = 0 then 'fornecedor' else 'cliente' end) order by s.i)
      into v_batch
      from (select i,
                   -- repetição: mesma chave (CNPJ e relacionamento) da linha anterior
                   case when i % 100 = 1 and i > 1 then i - 1 else i end as k
              from generate_series(b * 1000 + 1, least(n, b * 1000 + 1000)) i) s,
           lateral (select t.cnpj((40000000 + s.k)::text
                                  || case when s.k % 5 = 0 then '0002' else '0001' end) as c) g;

    t0 := clock_timestamp();
    v_res := public.tax_import_add_items(v_imp, v_batch);
    v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
    v_sum := v_sum + v_ms;
    v_max := greatest(v_max, v_ms);
  end loop;
  insert into t.timings values ('add_items (todos os lotes)', v_sum, n);
  insert into t.timings values ('add_items (pior lote)', v_max, 1000);

  -- Reenvio do último lote (retomada após falha de rede): nada muda.
  t0 := clock_timestamp();
  v_res := public.tax_import_add_items(v_imp, v_batch);
  insert into t.timings values ('reenvio de lote', extract(epoch from clock_timestamp() - t0) * 1000, 1000);
  perform t.eq('reenvio do mesmo lote não insere nada', (v_res->>'inserted')::int, 0);
  perform t.eq('recebidas = esperadas', (v_res->>'received_rows')::int, n);

  -- Finalização em trechos: o cliente chama até "done".
  v_sum := 0; v_max := 0; b := 0;
  loop
    t0 := clock_timestamp();
    v_res := public.tax_import_finalize(v_imp);
    v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
    v_sum := v_sum + v_ms; v_max := greatest(v_max, v_ms); b := b + 1;
    if b = 1 then
      perform t.eq('primeira chamada deixa a importação "finalizando"', v_res->>'status', 'finalizando');
      begin
        perform public.tax_import_cancel(v_imp);
        perform t.ok('importação em finalização não pode ser cancelada', false, 'cancelou');
      exception when others then
        perform t.ok('importação em finalização não pode ser cancelada', sqlerrm ilike '%andamento%', sqlerrm);
      end;
    end if;
    exit when (v_res->>'done')::boolean or b > 20;
  end loop;
  insert into t.timings values (format('finalize (%s chamadas)', b), v_sum, n);
  insert into t.timings values ('finalize (pior chamada)', v_max, 10000);
  perform t.ok('finalização terminou em até 10 chamadas', (v_res->>'done')::boolean and b <= 10, format('chamadas: %s', b));
  perform t.ok('nenhuma chamada passou de 4 s (timeout do Supabase: 8 s)', v_max < 4000, format('pior: %s ms', round(v_max)));
  insert into t.timings values ('total', extract(epoch from clock_timestamp() - t_all) * 1000, n);
  perform set_config('t.load_summary', v_res::text, false);
end $$;

select t.eq('carga: importação concluída',
  (select status::text from public.tax_imports where id = current_setting('t.load_imp')::uuid), 'concluida');
select t.eq('carga: CNPJs inválidos contados',
  (select (current_setting('t.load_summary')::jsonb->>'invalid_cnpj')::int), (:load_rows + 50) / 100);
select t.eq('carga: repetições no arquivo contadas',
  (select (current_setting('t.load_summary')::jsonb->>'duplicate_in_file')::int), (:load_rows - 1) / 100);
select t.eq('carga: válidas = recebidas − inválidas − repetidas',
  (select (current_setting('t.load_summary')::jsonb->>'valid')::int), :load_rows - (:load_rows + 50) / 100 - (:load_rows - 1) / 100);
select t.eq('carga: toda linha tem um status final',
  (select count(*) from public.tax_import_items
    where import_id = current_setting('t.load_imp')::uuid and status = 'recebido'), 0::bigint);
select t.eq('carga: válidas + duplicadas + inválidas = recebidas',
  (select count(*) from public.tax_import_items
    where import_id = current_setting('t.load_imp')::uuid
      and status in ('valido', 'ja_existente', 'duplicado_no_arquivo', 'cnpj_invalido')), :load_rows::bigint);
select t.ok('carga: relacionamentos novos gravados',
  (select count(*) from public.tax_relationships where tenant_id = t.id('co_a')) > :rel_before);
reset role;

-- Leitura com RLS (como a tela lê): contagens e uma página de 50 linhas.
create function t.time_read(p_user text, p_step text, p_sql text) returns void
language plpgsql as $f$
declare t0 timestamptz; v_n bigint;
begin
  perform t.claims(t.id(p_user));
  execute 'set role authenticated';
  t0 := clock_timestamp();
  execute p_sql into v_n;
  insert into t.timings values (p_step || ' [' || p_user || ']', extract(epoch from clock_timestamp() - t0) * 1000, v_n);
  execute 'reset role';
end $f$;
grant execute on function t.time_read(text, text, text) to authenticated;
select t.time_read('owner@co_a', 'RLS: contar relacionamentos', 'select count(*) from public.tax_relationships');
select t.time_read('owner@co_a', 'RLS: contar entidades (público)', 'select count(*) from public.tax_entities');
select t.time_read('owner@co_a', 'RLS: página de 50 linhas', format(
  $q$select count(*) from (select * from public.tax_import_items where import_id = %L
      and status = 'valido' order by row_number limit 50 offset 30000) x$q$, current_setting('t.load_imp')));
select t.time_read('platform_admin@plat', 'RLS: contar relacionamentos', 'select count(*) from public.tax_relationships');
select t.time_read('owner@co_b', 'RLS: contar entidades (público)', 'select count(*) from public.tax_entities');

do $$
declare r record;
begin
  for r in select * from t.timings loop
    raise notice 'TEMPO  %  % ms  (% linhas)', rpad(r.step, 28), round(r.ms, 1), r.rows;
  end loop;
end $$;
