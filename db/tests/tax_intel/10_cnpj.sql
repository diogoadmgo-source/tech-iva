-- CNPJ numérico e alfanumérico; raiz, ordem e matriz/filial.
select set_config('t.suite', 'cnpj', false);

select t.ok('exemplo oficial da Receita 12ABC34501DE35 é válido', public.tax_cnpj_is_valid('12ABC34501DE35'));
select t.ok('exemplo oficial com DV trocado é inválido', not public.tax_cnpj_is_valid('12ABC34501DE36'));
select t.ok('CNPJ numérico conhecido 00000000000191 é válido', public.tax_cnpj_is_valid('00000000000191'));
select t.ok('CNPJ numérico 11222333000181 é válido', public.tax_cnpj_is_valid('11222333000181'));
select t.ok('DV errado é inválido', not public.tax_cnpj_is_valid('11222333000182'));
select t.ok('letra no DV é inválido', not public.tax_cnpj_is_valid('12ABC34501DEA5'));
select t.ok('minúscula não passa sem normalizar', not public.tax_cnpj_is_valid('12abc34501de35'));
select t.ok('normalização converte para maiúscula', public.tax_cnpj_strip(' 12.abc.345/01de-35 ') = '12ABC34501DE35');
select t.ok('14 caracteres iguais é inválido', not public.tax_cnpj_is_valid('00000000000000'));
select t.ok('13 posições é inválido', not public.tax_cnpj_is_valid('1122233300018'));
select t.ok('caractere especial é inválido', not public.tax_cnpj_is_valid('1122233300#181'));
select t.ok('nulo é inválido', not public.tax_cnpj_is_valid(null));
select t.ok('gerador de teste concorda com o exemplo oficial', t.cnpj('12ABC34501DE') = '12ABC34501DE35');

-- Domínio barra CNPJ inválido em qualquer tabela.
select t.throws('domínio tax_cnpj recusa DV errado',
  $$insert into public.tax_entities (cnpj) values ('11222333000182')$$, 'tax_cnpj');

-- Colunas derivadas (generated): não podem divergir do CNPJ.
insert into public.tax_entities (cnpj) values ('12ABC34501DE35'), (t.cnpj('112223330001')), (t.cnpj('112223330002'));
select t.eq('raiz do alfanumérico', (select cnpj_raiz from public.tax_entities where cnpj = '12ABC34501DE35'), '12ABC345');
select t.eq('ordem do alfanumérico', (select cnpj_ordem from public.tax_entities where cnpj = '12ABC34501DE35'), '01DE');
select t.eq('dv do alfanumérico', (select cnpj_dv from public.tax_entities where cnpj = '12ABC34501DE35'), '35');
select t.ok('alfanumérico marcado', (select cnpj_alfanumerico from public.tax_entities where cnpj = '12ABC34501DE35'));
select t.ok('alfanumérico com ordem 01DE não é matriz', not (select is_matriz from public.tax_entities where cnpj = '12ABC34501DE35'));
select t.ok('ordem 0001 é matriz', (select is_matriz from public.tax_entities where cnpj = t.cnpj('112223330001')));
select t.ok('ordem 0002 é filial', not (select is_matriz from public.tax_entities where cnpj = t.cnpj('112223330002')));
select t.ok('numérico não marcado como alfanumérico', not (select cnpj_alfanumerico from public.tax_entities where cnpj = t.cnpj('112223330001')));
select t.eq('matriz e filial compartilham a raiz',
  (select count(distinct cnpj_raiz) from public.tax_entities where cnpj in (t.cnpj('112223330001'), t.cnpj('112223330002'))), 1::bigint);
select t.throws('coluna derivada não aceita escrita',
  $$update public.tax_entities set cnpj_raiz = 'XXXXXXXX' where cnpj = '12ABC34501DE35'$$, 'DEFAULT');

-- Limpa para as próximas suítes.
delete from public.tax_entities;

-- Concordância SQL × TypeScript: o executor carrega t.ts_cases (gerado pelo
-- vitest em scripts/tax-intel/gen-cnpj-cases.ts) antes desta suíte.
select t.eq('SQL e TypeScript concordam em todos os casos gerados',
  (select count(*) from t.ts_cases c where public.tax_cnpj_is_valid(c.cnpj) is distinct from c.valid), 0::bigint);
select t.ok('casos gerados incluem válidos e inválidos, numéricos e alfanuméricos',
  (select count(*) filter (where valid) > 1000 and count(*) filter (where not valid) > 1000
          and count(*) filter (where cnpj ~ '[A-Z]') > 1000 from t.ts_cases));
