-- Consulta Optantes assistida (0254): a pessoa consulta, o app grava IBS e CBS
-- como evidências do tenant. Dados SINTÉTICOS de teste.
select set_config('t.suite', 'consulta_optantes', false);

create temp table m4(nome text primary key, cnpj text);
insert into m4 values
  ('simples', t.cnpj('646464640001')),
  ('simples_filial', t.cnpj('646464640002')),
  ('real', t.cnpj('636363630001'));
insert into tax_entities (cnpj, public_classification)
  select cnpj, case when nome = 'real' then 'lucro_real' else 'simples_nacional' end::tax_classification from m4;
insert into tax_relationships (tenant_id, cnpj, relationship) select t.id('co_a'), cnpj, 'cliente' from m4;
grant select on m4 to authenticated, tax_ingestor;

select t.claims(t.id('viewer@co_a'));
set role authenticated;
select t.throws('viewer não registra consulta',
  format($q$select tax_register_consulta_optantes(%L, %L, 'nao', null, 'nao', null, now())$q$,
         t.id('co_a'), (select cnpj from m4 where nome = 'simples')), 'permissão');
reset role;

select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.throws('outro tenant não registra no tenant A',
  format($q$select tax_register_consulta_optantes(%L, %L, 'nao', null, 'nao', null, now())$q$,
         t.id('co_a'), (select cnpj from m4 where nome = 'simples')), 'permissão');
reset role;

select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.throws('só para optante do Simples',
  format($q$select tax_register_consulta_optantes(%L, %L, 'nao', null, 'nao', null, now())$q$,
         t.id('co_a'), (select cnpj from m4 where nome = 'real')), 'só se aplica');
select t.throws('CNPJ fora da base é recusado',
  format($q$select tax_register_consulta_optantes(%L, %L, 'nao', null, 'nao', null, now())$q$,
         t.id('co_a'), t.cnpj('626262620001')), 'não está na base');
select t.throws('resultado fora de sim/nao é recusado',
  format($q$select tax_register_consulta_optantes(%L, %L, 'talvez', null, 'nao', null, now())$q$,
         t.id('co_a'), (select cnpj from m4 where nome = 'simples')), 'sim ou nao');
select t.lives('owner registra "não optante"',
  format($q$select tax_register_consulta_optantes(%L, %L, 'nao', null, 'nao', null, now() - interval '1 hour')$q$,
         t.id('co_a'), (select cnpj from m4 where nome = 'simples')));
-- Nova consulta pela filial: mesma raiz, substitui a anterior.
select t.lives('nova consulta pela filial substitui a da raiz',
  format($q$select tax_register_consulta_optantes(%L, %L, 'sim', '2027-01-01', 'sim', '2027-01-01', now())$q$,
         t.id('co_a'), (select cnpj from m4 where nome = 'simples_filial')));
select t.eq('IBS e CBS ativos, um de cada',
  (select string_agg(fact::text || '=' || asserted_value::text || '@' || valid_from::text, ',' order by fact)
     from tax_evidences where tenant_id = t.id('co_a') and lookup_key = '64646464' and status = 'ativa'),
  'ibs_regular=sim@2027-01-01,cbs_regular=sim@2027-01-01');
select t.eq('consulta anterior fica como substituída',
  (select count(*)::int from tax_evidences where lookup_key = '64646464' and status = 'substituida'), 2);
select t.ok('nova aponta para a anterior',
  (select bool_and(supersedes_id is not null) from tax_evidences where lookup_key = '64646464' and status = 'ativa'));
select t.throws('front não grava evidência direto',
  format($q$insert into tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
    origin_description, document_date, responsible_user, valid_from) values (%L, 'ibs_regular', 'sim',
    '64646464', 'raiz', 'portal_simples_nacional', 'forjada', current_date, %L, current_date)$q$,
    t.id('co_a'), t.id('owner@co_a')), 'permission denied');
reset role;

select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.eq('tenant B não vê a evidência de A',
  (select count(*)::int from tax_evidences where lookup_key = '64646464'), 0);
reset role;

select t.ok('auditoria registrada',
  exists (select 1 from tax_audit_logs where action = 'tax.evidencia.consulta_optantes' and target_id = '64646464'));

-- Alvos do motor: só optantes do Simples, uma linha por raiz, matriz primeiro.
set session authorization tax_ingestor;
select t.eq('alvos do Simples por raiz, matriz primeiro',
  (select string_agg(cnpj, ',') from tax_ingest_simples_targets('64646463', 10) where cnpj_raiz = '64646464'),
  t.cnpj('646464640001'));
select t.eq('Lucro Real não entra nos alvos',
  (select count(*)::int from tax_ingest_simples_targets('63636362', 5000) where cnpj_raiz = '63636363'), 0);
reset session authorization;
select t.throws('front não lê os alvos do motor',
  $$set local role authenticated; select * from tax_ingest_simples_targets(null, 1)$$, 'permission denied');
