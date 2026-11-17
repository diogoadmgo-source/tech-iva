-- Permissões por papel (seção 3.5 da especificação), com os 9 papéis.
select set_config('t.suite', 'papeis', false);

-- Quem pode importar na Empresa A: platform_admin, platform_ops, channel_admin
-- (do canal pai), owner, finance. Os demais não.
create table t.role_matrix (user_name text, can_write boolean, can_audit boolean);
insert into t.role_matrix values
  ('platform_admin@plat', true, true),
  ('platform_ops@plat', true, true),
  ('platform_risk@plat', false, true),
  ('channel_admin@ch_c', true, true),
  ('channel_analyst@ch_c', false, false),
  ('owner@co_a', true, true),
  ('finance@co_a', true, true),
  ('commercial@co_a', false, false),
  ('viewer@co_a', false, false),
  ('channel_admin@ch_d', false, false),  -- canal de outra árvore
  ('owner@co_b', false, false);          -- outra empresa
grant select on t.role_matrix to authenticated;

do $$
declare r record; v_ok boolean; v_err text; v_n bigint;
begin
  for r in select * from t.role_matrix loop
    perform t.claims(t.id(r.user_name));
    execute 'set role authenticated';

    -- Importar
    begin
      perform public.tax_import_create(t.id('co_a'), 'papel.csv', 10, repeat('5', 64), 'csv', null, 1, 'cliente');
      v_ok := true;
    exception when others then
      v_ok := false; v_err := sqlerrm;
    end;
    perform t.ok(format('%s %s importar na Empresa A', r.user_name, case when r.can_write then 'pode' else 'não pode' end),
                 v_ok = r.can_write, v_err);

    -- Ler o log do módulo
    select count(*) into v_n from public.tax_audit_logs where tenant_id = t.id('co_a');
    perform t.ok(format('%s %s ler o log da Empresa A', r.user_name, case when r.can_audit then 'pode' else 'não pode' end),
                 (v_n > 0) = r.can_audit, format('linhas visíveis: %s', v_n));

    execute 'reset role';
  end loop;
end $$;

-- Leitura dos dados (não do log): todo papel com escopo em A lê a importação.
do $$
declare u text; v_n bigint;
begin
  foreach u in array array['viewer@co_a', 'commercial@co_a', 'channel_analyst@ch_c', 'platform_risk@plat'] loop
    perform t.claims(t.id(u));
    execute 'set role authenticated';
    select count(*) into v_n from public.tax_imports where tenant_id = t.id('co_a');
    perform t.ok(format('%s lê as importações de A (só leitura)', u), v_n > 0);
    execute 'reset role';
  end loop;
end $$;

-- Importação só em empresa ou unidade.
select t.claims(t.id('platform_admin@plat'));
set role authenticated;
select t.throws('não importa no tenant da plataforma',
  format($q$select public.tax_import_create(%L, 'x.csv', 10, repeat('6',64), 'csv', null, 1, null)$q$, t.id('plat')), 'empresa ou unidade');
select t.throws('não importa no tenant de canal',
  format($q$select public.tax_import_create(%L, 'x.csv', 10, repeat('6',64), 'csv', null, 1, null)$q$, t.id('ch_c')), 'empresa ou unidade');
select t.lives('importa na unidade',
  format($q$select public.tax_import_create(%L, 'x.csv', 10, repeat('6',64), 'csv', null, 1, null)$q$, t.id('un_a')));
reset role;

-- Nenhum papel grava direto nas tabelas (só por RPC).
select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.throws('owner não insere direto em tax_relationships',
  format($q$insert into public.tax_relationships (tenant_id, cnpj, relationship) values (%L, '11222333000181', 'cliente')$q$, t.id('co_a')),
  'permission denied');
select t.throws('owner não atualiza tax_imports direto',
  $$update public.tax_imports set status = 'concluida'$$, 'permission denied');
select t.throws('owner não apaga tax_import_items',
  $$delete from public.tax_import_items$$, 'permission denied');
select t.throws('owner não insere em tax_entities', $$insert into public.tax_entities (cnpj) values ('00000000000191')$$, 'permission denied');
select t.throws('owner não insere em tax_evidences',
  format($q$insert into public.tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
    origin_description, document_date, responsible_user, valid_from)
    values (%L, 'ibs_regular', 'sim', '11222333', 'raiz', 'outro', 'teste', current_date, auth.uid(), current_date)$q$, t.id('co_a')),
  'permission denied');
select t.throws('owner não chama a auditoria interna (não forja log)',
  format($q$select public.tax_audit(%L, 'tax.fake', 'x', null)$q$, t.id('co_a')), 'permission denied');
select t.throws('owner não chama tax_can_write (interna)',
  format($q$select public.tax_can_write(%L)$q$, t.id('co_a')), 'permission denied');
reset role;
