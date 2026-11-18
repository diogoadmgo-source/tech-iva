-- Processar pelo app (0251): permissão, anti-repetição, marcação, andamento
-- e o "pendente" que não rebaixa arquivo. Dados SINTÉTICOS de teste.
select set_config('t.suite', 'processar', false);

-- Estado limpo: nenhuma execução aberta (a suíte do motor deixa uma).
update tax_source_runs set status = 'concluida', finished_at = now() where status = 'iniciada';
-- A unidade A1 precisa de base própria para os testes de "base vazia" fazerem sentido.
delete from tax_relationships where tenant_id = t.id('un_a');

-- ---------------------------------------------------------------- permissão
select t.claims(t.id('viewer@co_a'));
set role authenticated;
select t.throws('viewer não processa', $$select tax_request_processing(t.id('co_a'))$$, 'sem permissão');
select t.eq('viewer vê o andamento, mas não pode processar',
  (tax_processing_status(t.id('co_a'))->>'pode_processar')::boolean, false);
reset role;

select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.throws('dono de B não processa a base de A', $$select tax_request_processing(t.id('co_a'))$$, 'sem permissão');
select t.throws('dono de B não lê o andamento de A', $$select tax_processing_status(t.id('co_a'))$$, 'sem acesso');
reset role;

select t.claims(t.id('owner@un_a'));
set role authenticated;
select t.eq('base vazia não dispara', tax_request_processing(t.id('un_a'))->>'motivo', 'base_vazia');
reset role;

-- ------------------------------------------------------ pedido e repetição
select t.claims(t.id('owner@co_a'));
set role authenticated;
create temp table req as select tax_request_processing(t.id('co_a')) r;
select t.eq('dono de A pede o processamento', ((select r from req)->>'ok')::boolean, true);
select t.eq('segundo clique logo depois é recusado', tax_request_processing(t.id('co_a'))->>'motivo', 'ja_solicitado');
select t.eq('andamento mostra o pedido como solicitado',
  tax_processing_status(t.id('co_a'))#>>'{solicitacao,status}', 'solicitado');
select t.eq('dono de A pode processar', (tax_processing_status(t.id('co_a'))->>'pode_processar')::boolean, true);
reset role;

select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.eq('outra empresa no mesmo minuto também espera (o motor roda tudo de uma vez)',
  tax_request_processing(t.id('co_b'))->>'motivo', 'ja_solicitado');
select t.throws('outro usuário não marca o pedido de A',
  format($$select tax_mark_processing_request(%L, 'enviado')$$, (select r->>'request_id' from req)), 'não encontrada');
reset role;

select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.throws('status de marcação inválido',
  format($$select tax_mark_processing_request(%L, 'concluido')$$, (select r->>'request_id' from req)), 'inválido');
select t.lives('quem pediu marca como enviado',
  format($$select tax_mark_processing_request(%L, 'enviado')$$, (select r->>'request_id' from req)));
select t.throws('não marca duas vezes',
  format($$select tax_mark_processing_request(%L, 'falhou', 'x')$$, (select r->>'request_id' from req)), 'não encontrada');
select t.eq('andamento mostra enviado', tax_processing_status(t.id('co_a'))#>>'{solicitacao,status}', 'enviado');
select t.eq('usuário não lê pedidos de outra empresa',
  (select count(*) from tax_processing_requests where tenant_id <> t.id('co_a')), 0::bigint);
reset role;

select t.eq('auditoria registra pedido e envio',
  (select count(*) from tax_audit_logs where tenant_id = t.id('co_a')
     and action in ('tax.processing.request', 'tax.processing.dispatch')
     and target_id = (select r->>'request_id' from req)), 2::bigint);
select t.eq('authenticated não grava pedido direto na tabela',
  has_table_privilege('authenticated', 'public.tax_processing_requests', 'insert'), false);

-- ------------------------------------------------- execução em andamento
update tax_processing_requests set requested_at = now() - interval '20 minutes';
insert into tax_source_runs (competencia, datasets, triggered_by) values ('2026-11', array['receita_simples'], 'teste');
select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.eq('com execução aberta, o pedido é recusado como em andamento',
  tax_request_processing(t.id('co_a'))->>'motivo', 'em_andamento');
select t.eq('andamento expõe a execução aberta', tax_processing_status(t.id('co_a'))#>>'{execucao,status}', 'iniciada');
reset role;
select t.claims(null);

-- ------------------------------------ "pendente" não rebaixa arquivo concluído
set session authorization tax_ingestor;
create temp table r3 as select (tax_ingest_start_run('2026-11', array['receita_simples'], 'teste')->>'run_id')::uuid id;
select tax_ingest_file((select id from r3), 'Simples.zip', null, null, null, 0, 0, 0, 'pendente');
select tax_ingest_file((select id from r3), 'Outro.zip', null, null, null, 0, 0, 0, 'pendente');
select tax_ingest_file((select id from r3), 'Simples.zip', 10, null, null, 100, 1, 100, 'concluido');
select tax_ingest_file((select id from r3), 'Simples.zip', null, null, null, 0, 0, 0, 'pendente');
reset session authorization;
select t.eq('pendente não rebaixa arquivo concluído',
  (select status from tax_source_run_files where run_id = (select id from r3) and file_name = 'Simples.zip'), 'concluido');
select t.eq('arquivo planejado aparece como pendente',
  (select status from tax_source_run_files where run_id = (select id from r3) and file_name = 'Outro.zip'), 'pendente');

select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.eq('andamento conta arquivos planejados e concluídos',
  (tax_processing_status(t.id('co_a'))#>>'{execucao,arquivos,total}') || '/' ||
  (tax_processing_status(t.id('co_a'))#>>'{execucao,arquivos,concluidos}'), '2/1');
reset role;
select t.claims(null);
