-- Acesso aos documentos: buckets tax-imports e tax-evidences (políticas de
-- storage.objects da migration 0240), com o RLS ligado como no Supabase.
select set_config('t.suite', 'documentos', false);

select t.ok('bucket tax-imports é privado', not (select public from storage.buckets where id = 'tax-imports'));
select t.ok('bucket tax-evidences é privado', not (select public from storage.buckets where id = 'tax-evidences'));
select t.eq('limite do bucket de importação (30 MB)', (select file_size_limit from storage.buckets where id = 'tax-imports'), 31457280::bigint);

-- Owner de A cria uma importação e recebe o caminho.
select t.claims(t.id('owner@co_a'));
set role authenticated;
select (public.tax_import_create(t.id('co_a'), 'docs.xlsx', 100, repeat('7', 64), 'xlsx', null, 1, 'cliente')) as c \gset
select (:'c'::jsonb->>'storage_path') as path, (:'c'::jsonb->>'import_id') as imp \gset

select t.lives('owner sobe o arquivo no caminho gerado',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-imports', %L)$q$, :'path'));
select t.throws('owner não sobe em outro caminho da própria pasta',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-imports', %L)$q$, t.id('co_a') || '/outro/arquivo.xlsx'),
  'row-level security');
select t.throws('owner não sobe na pasta de B',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-imports', %L)$q$, t.id('co_b') || '/' || :'imp' || '/docs.xlsx'),
  'row-level security');
select t.throws('caminho com ../ é recusado',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-evidences', %L)$q$, t.id('co_a') || '/../' || t.id('co_b') || '/x.pdf'),
  'row-level security');
select t.ok('owner baixa o arquivo da própria importação',
  exists (select 1 from storage.objects where bucket_id = 'tax-imports' and name = :'path'));
-- Sem política de UPDATE/DELETE: a operação não enxerga a linha (0 linhas).
do $d$
declare n int;
begin
  update storage.objects set name = name || 'x' where bucket_id = 'tax-imports';
  get diagnostics n = row_count;
  perform t.eq('arquivo enviado não é trocado (UPDATE afeta 0 linhas)', n, 0);
  delete from storage.objects where bucket_id = 'tax-imports';
  get diagnostics n = row_count;
  perform t.eq('arquivo enviado não é apagado (DELETE afeta 0 linhas)', n, 0);
end $d$;
reset role;

-- Outro usuário de escrita da MESMA empresa não sobe no caminho de uma
-- importação que ele não criou.
select t.claims(t.id('finance@co_a'));
set role authenticated;
select t.throws('finance não sobe arquivo na importação criada pelo owner',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-imports', %L)$q$, :'path' || '2'),
  'row-level security');
select t.ok('finance (escrita) baixa o arquivo importado', exists (select 1 from storage.objects where name = :'path'));
reset role;

-- Leitura do arquivo original (lista de clientes) é restrita a quem escreve.
select t.claims(t.id('viewer@co_a'));
set role authenticated;
select t.ok('viewer de A NÃO baixa o arquivo importado', not exists (select 1 from storage.objects where name = :'path'));
reset role;
select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.ok('owner de B NÃO baixa o arquivo de A', not exists (select 1 from storage.objects where name = :'path'));
reset role;

-- Depois de concluída, a importação não aceita mais arquivo.
select t.claims(t.id('owner@co_a'));
set role authenticated;
select public.tax_import_add_items(:'imp', '[{"r":1,"cnpj":"11222333000181"}]');
select public.tax_import_finalize(:'imp');
select t.throws('importação concluída não aceita novo upload',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-imports', %L)$q$, :'path' || '.v2'),
  'row-level security');
reset role;

-- Evidências: o registro da evidência (RPC da Fase 2) é simulado aqui como
-- superusuário; o que se testa é o acesso ao arquivo.
insert into public.tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
  origin_description, document_date, responsible_user, valid_from, valid_to, file_path, file_sha256, file_mime, file_size_bytes)
values (t.id('co_a'), 'ibs_regular', 'sim', '11222333', 'raiz', 'portal_simples_nacional',
  'Termo de opção enviado pelo cliente', '2026-09-20', t.id('owner@co_a'), '2027-01-01', '2027-06-30',
  t.id('co_a') || '/ev1/termo.pdf', repeat('8', 64), 'application/pdf', 1000);

select t.claims(t.id('finance@co_a'));
set role authenticated;
select t.lives('finance sobe evidência na pasta de A',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-evidences', %L)$q$, t.id('co_a') || '/ev1/termo.pdf'));
select t.throws('finance não sobe evidência na pasta de B',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-evidences', %L)$q$, t.id('co_b') || '/ev9/x.pdf'),
  'row-level security');
select t.throws('caminho sem UUID de tenant é recusado',
  $q$insert into storage.objects (bucket_id, name) values ('tax-evidences', 'publico/x.pdf')$q$, 'row-level security');
select t.ok('finance baixa evidência registrada de A',
  exists (select 1 from storage.objects where bucket_id = 'tax-evidences' and name = t.id('co_a') || '/ev1/termo.pdf'));
reset role;

select t.claims(t.id('viewer@co_a'));
set role authenticated;
select t.throws('viewer não sobe evidência',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-evidences', %L)$q$, t.id('co_a') || '/ev2/x.pdf'),
  'row-level security');
select t.ok('viewer não baixa o arquivo da evidência',
  not exists (select 1 from storage.objects where bucket_id = 'tax-evidences'));
select t.ok('viewer vê os metadados da evidência do próprio tenant',
  exists (select 1 from public.tax_evidences where tenant_id = t.id('co_a')));
reset role;

select t.claims(t.id('platform_risk@plat'));
set role authenticated;
select t.ok('platform_risk (auditoria) baixa a evidência',
  exists (select 1 from storage.objects where bucket_id = 'tax-evidences' and name = t.id('co_a') || '/ev1/termo.pdf'));
select t.throws('platform_risk não sobe evidência',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-evidences', %L)$q$, t.id('co_a') || '/ev3/x.pdf'),
  'row-level security');
reset role;

select t.claims(t.id('owner@co_b'));
set role authenticated;
select t.ok('B não baixa a evidência de A',
  not exists (select 1 from storage.objects where bucket_id = 'tax-evidences'));
select t.eq('B não vê os metadados da evidência de A',
  (select count(*) from public.tax_evidences), 0::bigint);
reset role;

-- Arquivo que subiu mas nunca virou evidência registrada não é baixável
-- (o download exige a linha em tax_evidences).
select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.lives('owner sobe arquivo ainda sem evidência registrada',
  format($q$insert into storage.objects (bucket_id, name) values ('tax-evidences', %L)$q$, t.id('co_a') || '/ev-orfa/x.pdf'));
select t.ok('arquivo sem evidência registrada não é baixável',
  not exists (select 1 from storage.objects where bucket_id = 'tax-evidences' and name like '%/ev-orfa/%'));
reset role;
