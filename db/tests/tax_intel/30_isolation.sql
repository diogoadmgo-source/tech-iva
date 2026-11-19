-- Isolamento entre tenants e entre os planos público e privado.
-- Pré-condição: 20_import.sql deixou dados da Empresa A.
select set_config('t.suite', 'isolamento', false);

-- Empresa B importa um CNPJ só dela e um que A também tem.
select t.claims(t.id('owner@co_b'));
set role authenticated;
select (public.tax_import_create(t.id('co_b'), 'b.csv', 10, repeat('1', 64), 'csv', null, 2, 'fornecedor')->>'import_id') as impb \gset
select public.tax_import_add_items(:'impb', jsonb_build_array(
  jsonb_build_object('r', 1, 'cnpj', t.cnpj('777666550001'), 'razao', 'Segredo de B'),
  jsonb_build_object('r', 2, 'cnpj', '11222333000181', 'razao', 'Nome que B usa')));
select public.tax_import_finalize(:'impb');

select t.eq('B vê só as próprias importações',
  (select count(*) from public.tax_imports where tenant_id <> t.id('co_b')), 0::bigint);
select t.eq('B não vê linhas importadas por A',
  (select count(*) from public.tax_import_items where tenant_id = t.id('co_a')), 0::bigint);
select t.eq('B não vê relacionamentos de A',
  (select count(*) from public.tax_relationships where tenant_id = t.id('co_a')), 0::bigint);
select t.eq('B não vê jobs de A',
  (select count(*) from public.tax_processing_jobs where tenant_id = t.id('co_a')), 0::bigint);
select t.eq('B não vê o log de A',
  (select count(*) from public.tax_audit_logs where tenant_id = t.id('co_a')), 0::bigint);
select t.eq('B enxerga no plano público só os CNPJs da própria carteira',
  (select count(*) from public.tax_entities), 2::bigint);
select t.ok('B não descobre pelo cache um CNPJ que só A importou',
  not exists (select 1 from public.tax_entities where cnpj = '12ABC34501DE35'));
select t.ok('CNPJ compartilhado aparece para B',
  exists (select 1 from public.tax_entities where cnpj = '11222333000181'));
select t.eq('nome declarado por A não aparece para B',
  (select count(*) from public.tax_relationships where declared_razao_social = 'Matriz SA Atualizada'), 0::bigint);
select t.throws('B não importa no tenant de A',
  format($q$select public.tax_import_create(%L, 'x.csv', 10, repeat('2',64), 'csv', null, 1, null)$q$, t.id('co_a')), 'forbidden');
reset role;

-- B tenta operar uma importação em andamento de A, pelo id.
select id as imp_a from public.tax_imports where tenant_id = t.id('co_a') and status = 'recebendo' limit 1 \gset
select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.throws('B não envia linhas para importação em andamento de A',
  format($q$select public.tax_import_add_items(%L, '[{"r":1,"cnpj":"11222333000181"}]')$q$, :'imp_a'), 'forbidden');
select t.throws('B não finaliza importação de A',
  format('select public.tax_import_finalize(%L)', :'imp_a'), 'forbidden');
select t.throws('B não cancela importação de A',
  format('select public.tax_import_cancel(%L)', :'imp_a'), 'forbidden');
reset role;

-- A não vê B.
select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.eq('A não vê importações de B', (select count(*) from public.tax_imports where tenant_id = t.id('co_b')), 0::bigint);
select t.ok('A não descobre o CNPJ exclusivo de B',
  not exists (select 1 from public.tax_entities where cnpj = t.cnpj('777666550001')));
reset role;

-- Hierarquia: canal C enxerga A (e a unidade), não B. Canal D enxerga B, não A.
select t.claims(t.id('channel_admin@ch_c'));
set role authenticated;
select t.ok('canal C vê importações de A', exists (select 1 from public.tax_imports where tenant_id = t.id('co_a')));
select t.eq('canal C não vê importações de B', (select count(*) from public.tax_imports where tenant_id = t.id('co_b')), 0::bigint);
select t.ok('canal C não vê CNPJ exclusivo de B', not exists (select 1 from public.tax_entities where cnpj = t.cnpj('777666550001')));
reset role;
select t.claims(t.id('channel_admin@ch_d'));
set role authenticated;
select t.eq('canal D não vê importações de A', (select count(*) from public.tax_imports where tenant_id = t.id('co_a')), 0::bigint);
select t.ok('canal D vê o CNPJ exclusivo de B', exists (select 1 from public.tax_entities where cnpj = t.cnpj('777666550001')));
reset role;

-- Unidade A1 (filha de A) não vê os dados da empresa-mãe.
select t.claims(t.id('owner@un_a'));
set role authenticated;
select t.eq('unidade não vê importações da empresa-mãe', (select count(*) from public.tax_imports where tenant_id = t.id('co_a')), 0::bigint);
reset role;

-- Plataforma enxerga tudo.
select t.claims(t.id('platform_admin@plat'));
set role authenticated;
select t.ok('plataforma vê A e B',
  (select count(distinct tenant_id) from public.tax_imports where tenant_id in (t.id('co_a'), t.id('co_b'))) = 2);
reset role;

-- anon não lê nada (sem privilégio de SELECT, nem com RLS).
select t.claims(null);
set role anon;
select t.throws('anon não lê tax_imports', 'select 1 from public.tax_imports', 'permission denied');
select t.throws('anon não lê tax_entities', 'select 1 from public.tax_entities', 'permission denied');
select t.throws('anon não lê tax_sources', 'select 1 from public.tax_sources', 'permission denied');
select t.throws('anon não lê tax_evidences', 'select 1 from public.tax_evidences', 'permission denied');
select t.throws('anon não executa tax_import_create',
  format($q$select public.tax_import_create(%L, 'x.csv', 10, repeat('2',64), 'csv', null, 1, null)$q$, t.id('co_a')), 'permission denied');
reset role;

-- Usuário autenticado sem vínculo nenhum.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000dead', 'sem-vinculo@test');
select t.claims('00000000-0000-0000-0000-00000000dead');
set role authenticated;
select t.eq('sem vínculo: nenhuma importação', (select count(*) from public.tax_imports), 0::bigint);
select t.eq('sem vínculo: nenhuma entidade', (select count(*) from public.tax_entities), 0::bigint);
select t.ok('sem vínculo: lê o catálogo de fontes', (select count(*) from public.tax_sources) = 7);
reset role;

-- As políticas usam tax_scope_tenants() (calculado uma vez por consulta).
-- Para cada usuário de teste, o conjunto deve ser exatamente o de in_scope().
do $$
declare u record; v_diff bigint;
begin
  for u in select name from t.ids where name like '%@%' loop
    perform t.claims(t.id(u.name));
    execute 'set role authenticated';
    select count(*) into v_diff from (
      (select id from public.tenants where public.in_scope(id)
       except select unnest(public.tax_scope_tenants()))
      union all
      (select unnest(public.tax_scope_tenants())
       except select id from public.tenants where public.in_scope(id))) d;
    execute 'reset role';
    perform t.eq(format('escopo das políticas = in_scope() para %s', u.name), v_diff, 0::bigint);
  end loop;
end $$;
