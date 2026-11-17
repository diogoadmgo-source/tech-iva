-- Importação: validação, normalização, duplicidade, matriz/filial, idempotência,
-- retomada, finalização e cancelamento. Executa como owner da Empresa A.
select set_config('t.suite', 'importacao', false);

select t.claims(t.id('owner@co_a'));
set role authenticated;

-- Base com 12 linhas cobrindo os casos.
-- 1  matriz 11222333/0001 cliente
-- 2  filial 11222333/0002 fornecedor (mesma raiz)
-- 3  alfanumérico oficial, "Ambos"
-- 4  DV errado
-- 5  vazio
-- 6  relacionamento desconhecido
-- 7  duplicado da linha 1 (mesmo par CNPJ+cliente)
-- 8  mesmo CNPJ da linha 1 como fornecedor (par novo → válido)
-- 9  zeros à esquerda perdidos pelo Excel (13 dígitos → completa 1 zero)
-- 10 minúsculas e máscara no alfanumérico, relacionamento vazio → padrão (cliente)
-- 11 alfanumérico com 13 posições (não pode ser completado)
-- 12 "Fornecedor" com acento/caixa variados
select (public.tax_import_create(t.id('co_a'), 'base clientes.xlsx', 1000, repeat('a', 64), 'xlsx',
        'Plan1', 12, 'cliente', 2)) as created \gset
select (:'created'::jsonb ->> 'import_id') as imp, (:'created'::jsonb ->> 'storage_path') as path \gset

select t.ok('caminho do arquivo é gerado pelo banco na pasta do tenant',
  :'path' = t.id('co_a')::text || '/' || :'imp' || '/base_clientes.xlsx');
select t.ok('job de importação criado',
  exists (select 1 from public.tax_processing_jobs where import_id = :'imp' and kind = 'importacao' and status = 'ativo'));

-- Lote 1 (linhas 1..6)
select (public.tax_import_add_items(:'imp', jsonb_build_array(
  jsonb_build_object('r', 1, 'cnpj', '11.222.333/0001-81', 'razao', 'Matriz SA', 'rel', 'Cliente'),
  jsonb_build_object('r', 2, 'cnpj', t.cnpj('112223330002'), 'razao', 'Matriz SA', 'fantasia', 'Filial 2', 'rel', 'fornecedor'),
  jsonb_build_object('r', 3, 'cnpj', '12.ABC.345/01DE-35', 'rel', 'Ambos'),
  jsonb_build_object('r', 4, 'cnpj', '11222333000182', 'rel', 'cliente'),
  jsonb_build_object('r', 5, 'cnpj', null, 'rel', 'cliente'),
  jsonb_build_object('r', 6, 'cnpj', t.cnpj('998887770001'), 'rel', 'parceiro')
))->>'received_rows')::int as received \gset
select t.eq('lote 1: 6 linhas recebidas', :received, 6);

-- Reenviar o mesmo lote não duplica (idempotência).
select t.eq('reenvio do lote 1 não grava nada novo',
  (public.tax_import_add_items(:'imp', jsonb_build_array(
     jsonb_build_object('r', 1, 'cnpj', 'OUTRO VALOR', 'rel', 'fornecedor')))->>'inserted')::int, 0);
select t.eq('reenvio não sobrescreve a linha original',
  (select cnpj::text from public.tax_import_items where import_id = :'imp' and row_number = 1), '11222333000181');

select t.throws('finalizar incompleto é recusado', format('select public.tax_import_finalize(%L)', :'imp'), 'incompleta');

-- Lote 2 (linhas 7..12)
select public.tax_import_add_items(:'imp', jsonb_build_array(
  jsonb_build_object('r', 7, 'cnpj', '11222333000181', 'rel', 'cliente'),
  jsonb_build_object('r', 8, 'cnpj', '11222333000181', 'rel', 'fornecedor'),
  jsonb_build_object('r', 9, 'cnpj', ltrim(t.cnpj('012345670001'), '0'), 'rel', 'cliente'),
  jsonb_build_object('r', 10, 'cnpj', ' 12.abc.345/01de-35 ', 'rel', ''),
  jsonb_build_object('r', 11, 'cnpj', '2ABC34501DE35', 'rel', 'cliente'),
  jsonb_build_object('r', 12, 'cnpj', t.cnpj('556667770001'), 'rel', ' FORNECEDOR ')
));

select (public.tax_import_finalize(:'imp')) as summary \gset

select t.eq('válidos', (:'summary'::jsonb->>'valid')::int, 6);
select t.eq('duplicados no arquivo', (:'summary'::jsonb->>'duplicate_in_file')::int, 2);
select t.eq('CNPJ inválido', (:'summary'::jsonb->>'invalid_cnpj')::int, 2);
select t.eq('CNPJ ausente', (:'summary'::jsonb->>'missing_cnpj')::int, 1);
select t.eq('relacionamento inválido', (:'summary'::jsonb->>'invalid_relationship')::int, 1);
select t.eq('já existentes (primeira importação)', (:'summary'::jsonb->>'already_existing')::int, 0);
select t.eq('zeros completados', (:'summary'::jsonb->>'padded')::int, 1);
select t.eq('CNPJs únicos (estabelecimentos)', (:'summary'::jsonb->>'unique_cnpjs')::int, 5);
select t.eq('raízes únicas (matriz e filial contam uma)', (:'summary'::jsonb->>'unique_roots')::int, 4);
select t.eq('relacionamentos novos', (:'summary'::jsonb->>'new_relationships')::int, 7);

-- linha 3 (Ambos) válida; linha 10 é o mesmo CNPJ só como cliente → duplicada.
select t.eq('linha 10: mesmo par da linha 3 → duplicado',
  (select status::text from public.tax_import_items where import_id = :'imp' and row_number = 10), 'duplicado_no_arquivo');
select t.eq('linha 8: mesmo CNPJ com outro relacionamento → válido',
  (select status::text from public.tax_import_items where import_id = :'imp' and row_number = 8), 'valido');
select t.eq('linha 9: 13 dígitos ganham o zero à esquerda',
  (select cnpj::text from public.tax_import_items where import_id = :'imp' and row_number = 9), t.cnpj('012345670001'));
select t.eq('linha 9: normalização registrada',
  (select normalization_note from public.tax_import_items where import_id = :'imp' and row_number = 9), 'zeros à esquerda completados');
select t.eq('linha 11: alfanumérico com 13 posições não é completado',
  (select status::text from public.tax_import_items where import_id = :'imp' and row_number = 11), 'cnpj_invalido');
select t.eq('linha 4: motivo do DV',
  (select error from public.tax_import_items where import_id = :'imp' and row_number = 4), 'Dígito verificador não confere');
select t.eq('linha 12: "FORNECEDOR" reconhecido',
  (select relationships::text from public.tax_import_items where import_id = :'imp' and row_number = 12), '{fornecedor}');
select t.eq('linha 3: "Ambos" vira dois relacionamentos',
  (select count(*) from public.tax_relationships where tenant_id = t.id('co_a') and cnpj = '12ABC34501DE35'), 2::bigint);
select t.eq('nome informado no arquivo fica no relacionamento (privado)',
  (select declared_razao_social from public.tax_relationships where tenant_id = t.id('co_a')
     and cnpj = '11222333000181' and relationship = 'cliente'), 'Matriz SA');
select t.ok('entidade pública NÃO recebe o nome informado pelo tenant',
  (select razao_social is null from public.tax_entities where cnpj = '11222333000181'));
select t.ok('entidade nasce como consulta pendente',
  (select bool_and(public_classification = 'consulta_pendente') from public.tax_entities));

-- Finalizar de novo devolve o mesmo resumo e não muda nada.
select t.ok('finalização repetida é idempotente', public.tax_import_finalize(:'imp') = :'summary'::jsonb);
select t.eq('relacionamentos não duplicam',
  (select count(*) from public.tax_relationships where tenant_id = t.id('co_a')), 7::bigint);
select t.throws('importação concluída não recebe linhas',
  format($q$select public.tax_import_add_items(%L, '[{"r":1,"cnpj":"x"}]')$q$, :'imp'), 'não está recebendo');
select t.ok('job concluído',
  exists (select 1 from public.tax_processing_jobs where import_id = :'imp' and status = 'concluido'));

-- Segunda importação: o que já existe no tenant aparece como "já existente".
select (public.tax_import_create(t.id('co_a'), 'base2.csv', 10, repeat('b', 64), 'csv', null, 3, null)->>'import_id') as imp2 \gset
select public.tax_import_add_items(:'imp2', jsonb_build_array(
  jsonb_build_object('r', 1, 'cnpj', '11222333000181', 'rel', 'cliente', 'razao', 'Matriz SA Atualizada'),
  jsonb_build_object('r', 2, 'cnpj', t.cnpj('123123120001'), 'rel', 'cliente'),
  jsonb_build_object('r', 3, 'cnpj', t.cnpj('123123120001'), 'rel', null)
));
select (public.tax_import_finalize(:'imp2')) as s2 \gset
select t.eq('2ª importação: já existente', (:'s2'::jsonb->>'already_existing')::int, 1);
select t.eq('2ª importação: válido novo', (:'s2'::jsonb->>'valid')::int, 1);
select t.eq('2ª importação: vazio sem padrão → relacionamento inválido', (:'s2'::jsonb->>'invalid_relationship')::int, 1);
select t.eq('nome declarado atualizado pela importação mais recente',
  (select declared_razao_social from public.tax_relationships where tenant_id = t.id('co_a')
     and cnpj = '11222333000181' and relationship = 'cliente'), 'Matriz SA Atualizada');
select t.eq('first_import_id preservado; last_import_id atualizado',
  (select (first_import_id::text = :'imp') and (last_import_id::text = :'imp2') from public.tax_relationships
    where tenant_id = t.id('co_a') and cnpj = '11222333000181' and relationship = 'cliente'), true);

-- Mesmo arquivo de novo: o banco avisa (same_file_imports).
select t.eq('reimportar o mesmo arquivo é sinalizado',
  jsonb_array_length(public.tax_import_create(t.id('co_a'), 'base2.csv', 10, repeat('b', 64), 'csv', null, 1, null)
                     ->'same_file_imports'), 1);

-- Validação dos lotes.
select (public.tax_import_create(t.id('co_a'), 'lotes.csv', 10, repeat('c', 64), 'csv', null, 1200, 'cliente')->>'import_id') as imp3 \gset
select t.throws('lote com 1.001 linhas é recusado',
  format($q$select public.tax_import_add_items(%L, (select jsonb_agg(jsonb_build_object('r', g, 'cnpj', '11222333000181')) from generate_series(1, 1001) g))$q$, :'imp3'),
  '1.000');
select t.throws('lote vazio é recusado', format($q$select public.tax_import_add_items(%L, '[]')$q$, :'imp3'), 'Lote inválido');
select t.throws('lote que não é lista é recusado', format($q$select public.tax_import_add_items(%L, '{"r":1}')$q$, :'imp3'), 'lista');
select t.throws('linha sem número é recusada', format($q$select public.tax_import_add_items(%L, '[{"cnpj":"1"}]')$q$, :'imp3'), 'fora do formato');
select t.throws('número de linha acima do esperado é recusado', format($q$select public.tax_import_add_items(%L, '[{"r":1201,"cnpj":"1"}]')$q$, :'imp3'), 'fora do formato');
select t.throws('CNPJ como número (não texto) é recusado', format($q$select public.tax_import_add_items(%L, '[{"r":1,"cnpj":11222333000181}]')$q$, :'imp3'), 'fora do formato');
select t.throws('texto acima do limite é recusado', format($q$select public.tax_import_add_items(%L, jsonb_build_array(jsonb_build_object('r',1,'razao',repeat('x',301))))$q$, :'imp3'), 'fora do formato');
select t.throws('número de linha repetido no lote é recusado', format($q$select public.tax_import_add_items(%L, '[{"r":1},{"r":1}]')$q$, :'imp3'), 'repetido');
select t.eq('lote recusado não grava nada', (select count(*) from public.tax_import_items where import_id = :'imp3'), 0::bigint);

-- Retomada: dois lotes, "queda", e o cliente continua pelo received_rows.
select public.tax_import_add_items(:'imp3', (select jsonb_agg(jsonb_build_object('r', g, 'cnpj', t.cnpj(lpad(g::text, 8, '0') || '0001'))) from generate_series(1, 1000) g));
select t.eq('retomada: banco informa 1.000 recebidas', (select received_rows from public.tax_imports where id = :'imp3'), 1000);
-- o cliente reenvia o último lote inteiro (não sabe se foi gravado) + o resto
select public.tax_import_add_items(:'imp3', (select jsonb_agg(jsonb_build_object('r', g, 'cnpj', t.cnpj(lpad(g::text, 8, '0') || '0001'))) from generate_series(1, 1000) g));
select public.tax_import_add_items(:'imp3', (select jsonb_agg(jsonb_build_object('r', g, 'cnpj', t.cnpj(lpad(g::text, 8, '0') || '0001'))) from generate_series(1001, 1200) g));
select t.eq('retomada: 1.200 recebidas sem duplicar', (select received_rows from public.tax_imports where id = :'imp3'), 1200);
select t.eq('retomada: finaliza com 1.200 válidos', (public.tax_import_finalize(:'imp3')->>'valid')::int, 1200);

-- Regra conservadora: só 12 ou 13 dígitos são completados. "191" (Banco do
-- Brasil sem os zeros) NÃO é adivinhado: fica inválido para o usuário corrigir.
select (public.tax_import_create(t.id('co_a'), 'curto.csv', 10, repeat('9', 64), 'csv', null, 1, 'cliente')->>'import_id') as imp5 \gset
select public.tax_import_add_items(:'imp5', '[{"r":1,"cnpj":"191"}]');
select t.eq('valor numérico curto (191) não é completado',
  (select status::text from public.tax_import_items where import_id = :'imp5' and row_number = 1), 'cnpj_invalido');
select t.throws('chave desconhecida no lote é recusada',
  format($q$select public.tax_import_add_items(%L, '[{"r":1,"cnpj":"1","tenant_id":"x"}]')$q$, :'imp5'), 'fora do formato');

-- Cancelamento.
select (public.tax_import_create(t.id('co_a'), 'cancelar.csv', 10, repeat('d', 64), 'csv', null, 5, 'cliente')->>'import_id') as imp4 \gset
select public.tax_import_add_items(:'imp4', '[{"r":1,"cnpj":"11222333000181"}]');
select t.eq('cancelar em andamento', public.tax_import_cancel(:'imp4')->>'status', 'cancelada');
select t.throws('cancelada não finaliza', format('select public.tax_import_finalize(%L)', :'imp4'), 'não pode ser finalizada');
select t.throws('cancelada não cancela de novo', format('select public.tax_import_cancel(%L)', :'imp4'), 'em andamento');
select t.ok('linhas da cancelada ficam para auditoria', exists (select 1 from public.tax_import_items where import_id = :'imp4'));

-- Entradas da criação.
select t.throws('arquivo acima de 30 MB', format($q$select public.tax_import_create(%L, 'a.csv', 31457281, repeat('e',64), 'csv', null, 1, null)$q$, t.id('co_a')), '30 MB');
select t.throws('mais de 100 mil linhas', format($q$select public.tax_import_create(%L, 'a.csv', 10, repeat('e',64), 'csv', null, 100001, null)$q$, t.id('co_a')), '100.000');
select t.throws('tipo de arquivo inválido', format($q$select public.tax_import_create(%L, 'a.xls', 10, repeat('e',64), 'xls', null, 1, null)$q$, t.id('co_a')), 'XLSX ou CSV');
select t.throws('hash inválido', format($q$select public.tax_import_create(%L, 'a.csv', 10, 'xyz', 'csv', null, 1, null)$q$, t.id('co_a')), 'Hash');
select t.ok('nome com ../ é saneado no caminho',
  (public.tax_import_create(t.id('co_a'), '../../etc/passwd', 10, repeat('f', 64), 'csv', null, 1, null)->>'storage_path') !~ '\.\.');

reset role;
