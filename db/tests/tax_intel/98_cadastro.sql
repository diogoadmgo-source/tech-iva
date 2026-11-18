-- Dados cadastrais no CNPJ (0253): abertura, CNAE, natureza jurídica e porte.
-- Dados SINTÉTICOS de teste.
select set_config('t.suite', 'cadastro', false);

update tax_source_runs set status = 'concluida', finished_at = now() where status = 'iniciada';
create temp table m3(nome text primary key, cnpj text);
insert into m3 values ('empresa', t.cnpj('565656560001'));
insert into tax_entities (cnpj) select cnpj from m3;
insert into tax_relationships (tenant_id, cnpj, relationship) select t.id('co_a'), cnpj, 'cliente' from m3;
grant select on m3 to tax_ingestor;

set session authorization tax_ingestor;
create temp table run4 as select (tax_ingest_start_run('2027-01',
  array['receita_empresas', 'receita_estabelecimentos'], 'teste')->>'run_id')::uuid id;

select tax_ingest_batch((select id from run4), 'receita_empresas', jsonb_build_array(
  jsonb_build_object('key', '56565656', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'razao_social', 'EMPRESA SINTETICA LTDA', 'natureza_juridica', '2062', 'natureza_descricao', '', 'porte', '03'))));
select tax_ingest_batch((select id from run4), 'receita_estabelecimentos', jsonb_build_array(
  jsonb_build_object('key', (select cnpj from m3), 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'situacao_cadastral', 'ATIVA', 'uf', 'GO', 'municipio', 'GOIANIA',
    'data_abertura', '2010-05-20', 'cnae_principal', '4530703', 'cnae_descricao', ''))));
-- Mesmo lote, agora com as descrições oficiais (cache da consulta, mas atualiza o cadastro).
select t.eq('lote repetido não grava consulta nova',
  (tax_ingest_batch((select id from run4), 'receita_empresas', jsonb_build_array(
    jsonb_build_object('key', '56565656', 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
      'razao_social', 'EMPRESA SINTETICA LTDA', 'natureza_juridica', '2062',
      'natureza_descricao', 'Sociedade Empresária Limitada', 'porte', '03'))))->>'cached')::int, 1);
select tax_ingest_batch((select id from run4), 'receita_estabelecimentos', jsonb_build_array(
  jsonb_build_object('key', (select cnpj from m3), 'status', 'ok', 'raw', '{}'::jsonb, 'n', jsonb_build_object(
    'situacao_cadastral', 'ATIVA', 'uf', 'GO', 'municipio', 'GOIANIA',
    'data_abertura', '2010-05-20', 'cnae_principal', '4530703',
    'cnae_descricao', 'Comércio a varejo de peças e acessórios novos para veículos automotores'))));
select tax_ingest_finish_run((select id from run4), 'concluida', '{}'::jsonb);
reset session authorization;

create temp view cad as select e.* from tax_entities e join m3 on m3.cnpj = e.cnpj;
select t.eq('natureza jurídica e porte gravados', (select natureza_juridica || '/' || porte from cad), '2062/03');
select t.eq('descrição da natureza vem no lote repetido', (select natureza_descricao from cad), 'Sociedade Empresária Limitada');
select t.eq('data de abertura gravada', (select data_abertura from cad), '2010-05-20'::date);
select t.eq('CNAE principal com descrição', (select cnae_principal || ' ' || left(cnae_descricao, 9) from cad), '4530703 Comércio ');
select t.throws('CNAE fora do formato é recusado pela tabela',
  $$update tax_entities set cnae_principal = '45.30-7' where cnpj = (select cnpj from m3)$$, 'check');
