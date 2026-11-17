-- Motor em massa (0242): papel do executor, validação de lote, idempotência,
-- retomada e regras de classificação pública. Dados SINTÉTICOS de teste.
select set_config('t.suite', 'motor', false);

create temp table base_b as select count(distinct cnpj) n from tax_relationships where tenant_id = t.id('co_b');
grant select on base_b to authenticated;
-- Carteira de teste: 7 CNPJs em 2 tenants (um repetido nos dois).
create temp table m(nome text primary key, cnpj text);
insert into m values
  ('simples', t.cnpj('111111110001')), ('mei', t.cnpj('222222220001')),
  ('nunca_sem_ecf', t.cnpj('333333330001')), ('nunca_com_real', t.cnpj('444444440001')),
  ('nunca_com_real_filial', t.cnpj('444444440002')), ('saiu_ecf_antiga', t.cnpj('555555550001')),
  ('saiu_ecf_nova', t.cnpj('666666660001')), ('fora', t.cnpj('999999990001'));
-- Só para o teste: o executor sintético lê a lista m e registra resultados em t.
grant select on m to tax_ingestor;
grant usage on schema t to tax_ingestor;
grant execute on all functions in schema t to tax_ingestor;
grant insert, select on t.results to tax_ingestor;
grant usage on sequence t.results_id_seq to tax_ingestor;
insert into tax_entities (cnpj) select cnpj from m where nome <> 'fora';
insert into tax_relationships (tenant_id, cnpj, relationship)
select t.id('co_a'), cnpj, 'cliente' from m where nome <> 'fora';
insert into tax_relationships (tenant_id, cnpj, relationship)
select t.id('co_b'), cnpj, 'fornecedor' from m where nome = 'simples';

select t.throws('authenticated não abre execução',
  $$set local role authenticated; select tax_ingest_start_run('2026-10', array['receita_simples'], 'x')$$, 'permission denied');
select t.throws('postgres (não tax_ingestor) não abre execução',
  $$select tax_ingest_start_run('2026-10', array['receita_simples'], 'x')$$, 'forbidden');
select t.eq('authenticated não executa a classificação interna',
  has_function_privilege('authenticated', 'public.tax_classify_compute(text)', 'execute'), false);
select t.eq('tax_ingestor não lê tabela nenhuma diretamente',
  (select count(*) from information_schema.role_table_grants where grantee = 'tax_ingestor' and table_schema = 'public'), 0::bigint);

create temp table tot as select count(distinct cnpj) n from tax_relationships;
grant select on tot to tax_ingestor;
set session authorization tax_ingestor;
create temp table run as select (tax_ingest_start_run('2026-10',
  array['receita_simples', 'receita_regime_tributario'], 'teste')->>'run_id')::uuid id;

-- Paginado como o executor faz (no máximo 50 mil por chamada).
create temp table alvos(cnpj text);
do $$
declare v_after text; v_n bigint;
begin
  loop
    with ins as (insert into alvos select cnpj from tax_ingest_targets((select id from run), v_after, 50000) returning cnpj)
    select max(cnpj), count(*) into v_after, v_n from ins;
    exit when v_n < 50000;
  end loop;
end $$;
select t.eq('alvos = CNPJs distintos das carteiras, sem duplicar o repetido',
  (select count(*) from alvos), (select n from tot));
select t.eq('alvos sem repetição entre páginas', (select count(distinct cnpj) from alvos), (select n from tot));
select t.eq('os 7 CNPJs de teste estão nos alvos, uma vez cada',
  (select count(*) from alvos x join m on m.cnpj = x.cnpj), 7::bigint);
select t.eq('reabrir a mesma competência retoma a mesma execução',
  (tax_ingest_start_run('2026-10', array['receita_simples', 'receita_regime_tributario'], 'teste')->>'run_id')::uuid,
  (select id from run));
select t.throws('outra competência com execução aberta é recusada',
  $$select tax_ingest_start_run('2026-11', array['receita_simples'], 'teste')$$, 'execução aberta');

select t.throws('lote com CNPJ fora das carteiras é recusado inteiro',
  format($$select tax_ingest_batch(%L, 'receita_simples', %L::jsonb)$$, (select id from run),
    jsonb_build_array(jsonb_build_object('key', '11111111', 'status', 'nao_encontrado'),
                      jsonb_build_object('key', '99999999', 'status', 'nao_encontrado'))), 'fora das carteiras');
select t.throws('fonte que não está na execução é recusada',
  format($$select tax_ingest_batch(%L, 'receita_empresas', '[{"key":"11111111","status":"nao_encontrado"}]')$$,
         (select id from run)), 'não faz parte');

-- Arquivo do Simples: 4 raízes presentes, 2 ausentes (nunca optaram).
create temp table simples as select jsonb_build_array(
  jsonb_build_object('key', '11111111', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'S', 'data_opcao_simples', '2018-01-01', 'data_exclusao_simples', null,
    'opcao_mei', 'N', 'data_opcao_mei', null, 'data_exclusao_mei', null)),
  jsonb_build_object('key', '22222222', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'S', 'data_opcao_simples', '2020-03-01', 'data_exclusao_simples', null,
    'opcao_mei', 'S', 'data_opcao_mei', '2020-03-01', 'data_exclusao_mei', null)),
  jsonb_build_object('key', '55555555', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'N', 'data_opcao_simples', '2019-01-01', 'data_exclusao_simples', '2025-01-31',
    'opcao_mei', 'N', 'data_opcao_mei', null, 'data_exclusao_mei', null)),
  jsonb_build_object('key', '66666666', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'N', 'data_opcao_simples', '2015-01-01', 'data_exclusao_simples', '2021-12-31',
    'opcao_mei', 'N', 'data_opcao_mei', null, 'data_exclusao_mei', null)),
  jsonb_build_object('key', '33333333', 'status', 'nao_encontrado'),
  jsonb_build_object('key', '44444444', 'status', 'nao_encontrado')) j;

select t.eq('1ª gravação do Simples insere 6',
  (tax_ingest_batch((select id from run), 'receita_simples', (select j from simples))->>'inserted')::int, 6);
select t.eq('repetir o mesmo lote não duplica (cache)',
  (tax_ingest_batch((select id from run), 'receita_simples', (select j from simples))->>'cached')::int, 6);

-- ECF: Real 2024 para a raiz 44444444 (só na matriz); Presumido 2018 para 55555555
-- (antes de sair do Simples em 2025); Presumido 2023 para 66666666 (depois de sair em 2021).
select t.eq('ECF gravada',
  (tax_ingest_batch((select id from run), 'receita_regime_tributario', jsonb_build_array(
    jsonb_build_object('key', (select cnpj from m where nome = 'nunca_com_real'), 'status', 'ok', 'raw', '{}'::jsonb,
      'n', jsonb_build_object('linhas', jsonb_build_array(jsonb_build_object('ano', '2024', 'forma', 'LUCRO REAL')))),
    jsonb_build_object('key', (select cnpj from m where nome = 'saiu_ecf_antiga'), 'status', 'ok', 'raw', '{}'::jsonb,
      'n', jsonb_build_object('linhas', jsonb_build_array(jsonb_build_object('ano', '2018', 'forma', 'LUCRO PRESUMIDO')))),
    jsonb_build_object('key', (select cnpj from m where nome = 'saiu_ecf_nova'), 'status', 'ok', 'raw', '{}'::jsonb,
      'n', jsonb_build_object('linhas', jsonb_build_array(jsonb_build_object('ano', '2023', 'forma', 'LUCRO PRESUMIDO')))),
    jsonb_build_object('key', (select cnpj from m where nome = 'nunca_sem_ecf'), 'status', 'nao_encontrado')
  ))->>'inserted')::int, 4);

-- Em trechos de até 10 mil, como o executor faz.
create temp table cl(processed bigint);
do $$
declare r jsonb; v_after text;
begin
  loop
    r := tax_ingest_classify((select id from run), v_after, 10000);
    exit when (r->>'done')::boolean;
    insert into cl values ((r->>'processed')::bigint);
    v_after := r->>'last';
  end loop;
end $$;
select t.eq('classificação processa a carteira inteira',
  (select sum(processed) from cl)::bigint, (select n from tot));
reset session authorization;

create temp view cls as
select m.nome, e.public_classification::text c, e.public_classification_basis b
  from m join tax_entities e on e.cnpj = m.cnpj;

select t.eq('Simples ativo → simples_nacional', (select c from cls where nome = 'simples'), 'simples_nacional');
select t.eq('SIMEI ativo → mei_simei', (select c from cls where nome = 'mei'), 'mei_simei');
select t.eq('NUNCA optou e sem ECF → nao_identificado (nunca Presumido)',
  (select c from cls where nome = 'nunca_sem_ecf'), 'nao_identificado');
select t.ok('... e a base diz que ausência de Simples não indica Presumido nem Real',
  (select b->>'aviso' from cls where nome = 'nunca_sem_ecf') ilike '%não indica Lucro Presumido nem Lucro Real%');
select t.eq('não optante com ECF Real 2024 → lucro_real', (select c from cls where nome = 'nunca_com_real'), 'lucro_real');
select t.eq('... com o ano-calendário na base', (select b->>'ano_calendario' from cls where nome = 'nunca_com_real'), '2024');
select t.eq('filial herda a ECF da raiz', (select c from cls where nome = 'nunca_com_real_filial'), 'lucro_real');
select t.eq('ECF anterior à saída do Simples não decide → excluido_simples',
  (select c from cls where nome = 'saiu_ecf_antiga'), 'excluido_simples');
select t.eq('ECF posterior à saída do Simples → lucro_presumido', (select c from cls where nome = 'saiu_ecf_nova'), 'lucro_presumido');
select t.eq('CNPJ fora das carteiras não foi criado', (select count(*) from tax_entities where cnpj = (select cnpj from m where nome = 'fora')), 0::bigint);
select t.eq('períodos de regime gravados (Simples e SIMEI)',
  (select count(*) from tax_regimes where lookup_key in ('11111111', '22222222', '55555555', '66666666')), 5::bigint);
select t.throws('consulta gravada é imutável', $$update tax_consultations set status = 'erro'$$, 'imutável');

-- Nova competência: o optante sai do Simples. Gera evento e muda a classe.
set session authorization tax_ingestor;
select tax_ingest_finish_run((select id from run), 'concluida', '{}'::jsonb);
create temp table run2 as select (tax_ingest_start_run('2026-11', array['receita_simples'], 'teste')->>'run_id')::uuid id;
select tax_ingest_batch((select id from run2), 'receita_simples', jsonb_build_array(
  jsonb_build_object('key', '11111111', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'N', 'data_opcao_simples', '2018-01-01', 'data_exclusao_simples', '2026-10-31',
    'opcao_mei', 'N', 'data_opcao_mei', null, 'data_exclusao_mei', null))));
do $$
declare r jsonb; v_after text;
begin
  loop
    r := tax_ingest_classify((select id from run2), v_after, 10000);
    exit when (r->>'done')::boolean;
    v_after := r->>'last';
  end loop;
end $$;
reset session authorization;
select t.eq('saída do Simples na competência nova → excluido_simples', (select c from cls where nome = 'simples'), 'excluido_simples');
select t.eq('período do Simples fechado com a data de exclusão',
  (select end_date from tax_regimes where lookup_key = '11111111' and regime = 'simples_nacional'), '2026-10-31'::date);
select t.eq('evento de mudança de classe registrado',
  (select count(*) from tax_regime_events where event_type = 'mudanca_classificacao_publica'
     and lookup_key = (select cnpj from m where nome = 'simples')), 1::bigint);

-- Leitura pelo tenant: a carteira B só vê o próprio CNPJ.
select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.eq('tenant B vê só a sua carteira no resumo (+1 CNPJ de teste)',
  (tax_portfolio_status(t.id('co_b'))->>'cnpjs')::bigint, (select n + 1 from base_b));
select t.eq('tenant B não lê a carteira de A pelo resumo', (tax_portfolio_status(t.id('co_a'))->>'cnpjs')::int, 0);
reset role;
select t.claims(null);
