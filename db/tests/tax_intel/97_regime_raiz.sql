-- Correções do piloto (0252): ECF por raiz, saída do Simples no meio do ano e
-- CNPJ que não consta no cadastro da Receita. Dados SINTÉTICOS de teste.
select set_config('t.suite', 'regime_raiz', false);

update tax_source_runs set status = 'concluida', finished_at = now() where status = 'iniciada';

create temp table m2(nome text primary key, cnpj text);
insert into m2 values
  ('filial_sem_matriz', t.cnpj('777777770002')),   -- matriz ...0001 fora da base
  ('saiu_meio_do_ano', t.cnpj('888888880001')),    -- saiu em 30/06/2024, ECF 2024 Real
  ('saiu_fim_do_ano', t.cnpj('818181810001')),     -- saiu em 31/12/2024, ECF 2024 Presumido
  ('inexistente', t.cnpj('939393930001')),         -- raiz "optante", mas o CNPJ não existe
  ('provavel_cpf', t.cnpj('000748239818')),        -- "000" + 11 dígitos que formam CPF válido
  ('linha_de_outra_raiz', t.cnpj('828282820001')); -- ECF com declarante de outra raiz
insert into tax_entities (cnpj) select cnpj from m2;
insert into tax_relationships (tenant_id, cnpj, relationship) select t.id('co_a'), cnpj, 'cliente' from m2;
grant select on m2 to tax_ingestor;

set session authorization tax_ingestor;
create temp table run3 as select (tax_ingest_start_run('2026-12',
  array['receita_simples', 'receita_estabelecimentos', 'receita_regime_tributario'], 'teste')->>'run_id')::uuid id;

select tax_ingest_batch((select id from run3), 'receita_simples', jsonb_build_array(
  jsonb_build_object('key', '77777777', 'status', 'nao_encontrado'),
  jsonb_build_object('key', '82828282', 'status', 'nao_encontrado'),
  jsonb_build_object('key', '00074823', 'status', 'nao_encontrado'),
  jsonb_build_object('key', '88888888', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'N', 'data_opcao_simples', '2019-01-01', 'data_exclusao_simples', '2024-06-30',
    'opcao_mei', 'N', 'data_opcao_mei', null, 'data_exclusao_mei', null)),
  jsonb_build_object('key', '81818181', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'N', 'data_opcao_simples', '2019-01-01', 'data_exclusao_simples', '2024-12-31',
    'opcao_mei', 'N', 'data_opcao_mei', null, 'data_exclusao_mei', null)),
  jsonb_build_object('key', '93939393', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'opcao_simples', 'S', 'data_opcao_simples', '2019-01-01', 'data_exclusao_simples', null,
    'opcao_mei', 'N', 'data_opcao_mei', null, 'data_exclusao_mei', null))));

select tax_ingest_batch((select id from run3), 'receita_estabelecimentos', jsonb_build_array(
  jsonb_build_object('key', (select cnpj from m2 where nome = 'inexistente'), 'status', 'nao_encontrado'),
  jsonb_build_object('key', (select cnpj from m2 where nome = 'provavel_cpf'), 'status', 'nao_encontrado')));

select t.throws('lote do regime misturando raiz e CNPJ é recusado',
  format($$select tax_ingest_batch(%L, 'receita_regime_tributario', %L::jsonb)$$, (select id from run3),
    jsonb_build_array(jsonb_build_object('key', '77777777', 'status', 'nao_encontrado'),
                      jsonb_build_object('key', (select cnpj from m2 where nome = 'saiu_meio_do_ano'), 'status', 'nao_encontrado'))),
  'fora do formato');

-- Como o executor envia agora: chave = raiz, CNPJ declarante (matriz) em cada linha.
select t.eq('regime por raiz gravado',
  (tax_ingest_batch((select id from run3), 'receita_regime_tributario', jsonb_build_array(
    jsonb_build_object('key', '77777777', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('cnpj', t.cnpj('777777770001'), 'ano', '2024', 'forma', 'LUCRO PRESUMIDO')))),
    jsonb_build_object('key', '88888888', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('cnpj', t.cnpj('888888880001'), 'ano', '2024', 'forma', 'LUCRO REAL')))),
    jsonb_build_object('key', '81818181', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('cnpj', t.cnpj('818181810001'), 'ano', '2024', 'forma', 'LUCRO PRESUMIDO')))),
    jsonb_build_object('key', '82828282', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('cnpj', t.cnpj('777777770001'), 'ano', '2024', 'forma', 'LUCRO REAL')))),
    jsonb_build_object('key', '93939393', 'status', 'nao_encontrado')
  ))->>'inserted')::int, 5);

do $$
declare r jsonb; v_after text;
begin
  loop
    r := tax_ingest_classify((select id from run3), v_after, 10000);
    exit when (r->>'done')::boolean;
    v_after := r->>'last';
  end loop;
end $$;
select tax_ingest_finish_run((select id from run3), 'concluida', '{}'::jsonb);
reset session authorization;

create temp view cls2 as
select m2.nome, e.public_classification::text c, e.public_classification_basis b
  from m2 join tax_entities e on e.cnpj = m2.cnpj;

select t.eq('filial cuja matriz não está na base recebe a ECF da matriz',
  (select c from cls2 where nome = 'filial_sem_matriz'), 'lucro_presumido');
select t.eq('... e o histórico guarda o CNPJ declarante (a matriz)',
  (select cnpj::text from tax_regime_history where cnpj_raiz = '77777777'), t.cnpj('777777770001'));
select t.eq('saída do Simples no meio do ano: a ECF do próprio ano decide',
  (select c from cls2 where nome = 'saiu_meio_do_ano'), 'lucro_real');
select t.eq('saída em 31/12: a ECF daquele ano ainda é do Simples, não decide',
  (select c from cls2 where nome = 'saiu_fim_do_ano'), 'excluido_simples');
select t.eq('linha com declarante de outra raiz é descartada',
  (select count(*) from tax_regime_history where cnpj_raiz = '82828282'), 0::bigint);
select t.eq('... e a empresa fica não identificada', (select c from cls2 where nome = 'linha_de_outra_raiz'), 'nao_identificado');
select t.eq('CNPJ fora do cadastro da Receita não herda o Simples da raiz',
  (select c from cls2 where nome = 'inexistente'), 'nao_identificado');
select t.eq('... e a base explica o motivo',
  (select b->>'cnpj_inexistente' from cls2 where nome = 'inexistente'), 'true');
select t.eq('... sem marcar como provável CPF quando não é', (select b->>'provavel_cpf' from cls2 where nome = 'inexistente'), null);
select t.eq('"000" + CPF válido fora do cadastro → provável CPF',
  (select b->>'provavel_cpf' from cls2 where nome = 'provavel_cpf'), 'true');
select t.ok('... com motivo explícito', (select b->>'motivo' from cls2 where nome = 'provavel_cpf') ilike 'Provável CPF%');
select t.eq('validação de CPF', array[tax_cpf_is_valid('74823981804'), tax_cpf_is_valid('74823981805'),
  tax_cpf_is_valid('11111111111')], array[true, false, false]);
select t.eq('authenticated não executa a validação interna de CPF',
  has_function_privilege('authenticated', 'public.tax_cpf_is_valid(text)', 'execute'), false);
