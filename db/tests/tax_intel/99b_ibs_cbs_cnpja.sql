-- Opção IBS/CBS pela CNPJá (0255). Dados SINTÉTICOS de teste.
select set_config('t.suite', 'ibs_cbs_cnpja', false);

create temp table m5(nome text primary key, cnpj text);
insert into m5 values
  ('optou_matriz', t.cnpj('616161610001')),
  ('optou_filial', t.cnpj('616161610002')),
  ('nao_optou', t.cnpj('606060600001'));
insert into tax_entities (cnpj, public_classification) select cnpj, 'simples_nacional' from m5;
insert into tax_relationships (tenant_id, cnpj, relationship) select t.id('co_a'), cnpj, 'cliente' from m5;
grant select on m5 to tax_ingestor;

set session authorization tax_ingestor;
select t.eq('alvos: uma linha por raiz ainda sem consulta',
  (select count(*)::int from tax_ingest_ibs_cbs_targets('60606059', 10) where cnpj_raiz in ('61616161', '60606060')), 2);
select t.eq('lote gravado',
  tax_ingest_ibs_cbs(jsonb_build_array(
    jsonb_build_object('raiz', '61616161', 'status', 'ok', 'http', 200, 'ibs', 'sim', 'ibs_desde', '2027-01-01',
      'cbs', 'sim', 'cbs_desde', '2027-01-01', 'raw', '{"optant": true, "events": [{"regime": "IBS"}]}'::jsonb),
    jsonb_build_object('raiz', '60606060', 'status', 'ok', 'http', 200, 'ibs', 'nao', 'cbs', 'nao', 'raw', '{"optant": true, "events": []}'::jsonb),
    jsonb_build_object('raiz', '59595959', 'status', 'erro', 'http', 500, 'erro', 'falha'))),
  '{"ok": 2, "erros": 1, "cnpjs_atualizados": 3}'::jsonb);
select t.eq('consultado não volta como alvo',
  (select count(*)::int from tax_ingest_ibs_cbs_targets('60606059', 10) where cnpj_raiz in ('61616161', '60606060')), 0);
select t.eq('volta quando a consulta passa da idade',
  (select count(*)::int from tax_ingest_ibs_cbs_targets('60606059', 10, 0) where cnpj_raiz in ('61616161', '60606060')), 2);
select t.throws('valor fora de sim/nao é recusado',
  $$select tax_ingest_ibs_cbs('[{"raiz":"61616161","status":"ok","ibs":"talvez","cbs":"nao"}]')$$, 'sim ou nao');
reset session authorization;

select t.eq('filial recebe a opção da raiz',
  (select ibs_regular::text || '@' || ibs_desde || '/' || cbs_regular from tax_entities where cnpj = (select cnpj from m5 where nome = 'optou_filial')),
  'sim@2027-01-01/sim');
select t.eq('não optante sem data',
  (select ibs_regular::text || coalesce(ibs_desde::text, '-') from tax_entities where cnpj = (select cnpj from m5 where nome = 'nao_optou')), 'nao-');
select t.eq('consultas imutáveis registradas',
  (select count(*)::int from tax_consultations where source_code = 'cnpja_simples'), 3);

select t.claims(t.id('owner@co_a'));
set role authenticated;
select t.throws('front não grava pela rota do motor',
  $$select tax_ingest_ibs_cbs('[]')$$, 'permission denied');
reset role;
