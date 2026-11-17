-- Imutabilidade (mesmo para o dono das tabelas) e auditoria das operações.
select set_config('t.suite', 'imutabilidade_auditoria', false);

-- Dados públicos mínimos, gravados como o executor/servidor gravaria.
insert into public.tax_consultations (id, source_code, dataset_version, lookup_key, granularity, status, response_normalized)
values ('00000000-0000-0000-0000-0000000c0001', 'receita_simples', '2026-11', '11222333', 'raiz', 'ok', '{"opcao":"S"}');
insert into public.tax_regimes (regime, lookup_key, granularity, start_date, consultation_id)
values ('simples_nacional', '11222333', 'raiz', '2020-01-01', '00000000-0000-0000-0000-0000000c0001');
insert into public.tax_regime_history (cnpj, ano, forma_tributacao_original, regime_normalizado, dataset_version, consultation_id)
values ('11222333000181', 2024, 'LUCRO PRESUMIDO', 'lucro_presumido', '2026-11', '00000000-0000-0000-0000-0000000c0001');
insert into public.tax_regime_events (lookup_key, granularity, event_type, event_date, effective_date, consultation_id)
values ('11222333', 'raiz', 'exclusao_simples', '2026-11-10', '2027-01-01', '00000000-0000-0000-0000-0000000c0001');

-- Como superusuário (postgres), que ignora RLS e privilégios: os gatilhos barram.
select t.throws('consulta não é alterada', $$update public.tax_consultations set status = 'erro'$$, 'imutável');
select t.throws('consulta não é apagada', $$delete from public.tax_consultations$$, 'imutável');
select t.throws('consulta não é truncada', $$truncate public.tax_consultations cascade$$, 'imutável');
select t.throws('histórico ECF não é alterado', $$update public.tax_regime_history set ano = 2023$$, 'imutável');
select t.throws('histórico ECF não é apagado', $$delete from public.tax_regime_history$$, 'imutável');
select t.throws('evento não é alterado', $$update public.tax_regime_events set effective_date = null$$, 'imutável');
select t.throws('evento não é apagado', $$delete from public.tax_regime_events$$, 'imutável');
select t.throws('log não é alterado', $$update public.tax_audit_logs set action = 'tax.fake'$$, 'imutável');
select t.throws('log não é apagado', $$delete from public.tax_audit_logs$$, 'imutável');
select t.throws('log não é truncado', $$truncate public.tax_audit_logs$$, 'imutável');

select t.lives('período de regime aberto pode ganhar data de fim',
  $$update public.tax_regimes set end_date = '2026-12-31' where lookup_key = '11222333'$$);
select t.throws('período fechado não muda de novo',
  $$update public.tax_regimes set end_date = '2027-12-31' where lookup_key = '11222333'$$, 'fechado');
select t.throws('período de regime não é apagado', $$delete from public.tax_regimes$$, 'imutável');

-- Evidência: conteúdo imutável; só ativa → revogada/substituida.
select t.throws('conteúdo da evidência não muda',
  $$update public.tax_evidences set valid_from = '2026-01-01'$$, 'imutável');
select t.throws('evidência não é apagada', $$delete from public.tax_evidences$$, 'imutável');
select t.lives('evidência ativa pode ser revogada (com motivo)',
  $$update public.tax_evidences set status = 'revogada', revoked_at = now(), revoke_reason = 'cancelada até 30/11' where status = 'ativa'$$);
select t.throws('evidência revogada não volta a ativa',
  $$update public.tax_evidences set status = 'ativa'$$, 'imutável');

-- IBS e CBS independentes: evidência só de CBS é aceita sem a de IBS.
select t.lives('evidência só de CBS (sem IBS) é aceita',
  format($q$insert into public.tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
    origin_description, document_date, responsible_user, valid_from)
    values (%L, 'cbs_regular', 'sim', '11222333', 'raiz', 'declaracao_contribuinte', 'Declaração do fornecedor', '2026-09-15', %L, '2027-01-01')$q$,
    t.id('co_a'), t.id('owner@co_a')));
select t.throws('evidência não aceita valor "não identificado"',
  format($q$insert into public.tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
    origin_description, document_date, responsible_user, valid_from)
    values (%L, 'ibs_regular', 'nao_identificado', '11222333', 'raiz', 'outro', 'x x x', '2026-09-15', %L, '2027-01-01')$q$,
    t.id('co_a'), t.id('owner@co_a')), 'check');
select t.throws('arquivo de evidência fora da pasta do tenant é recusado',
  format($q$insert into public.tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
    origin_description, document_date, responsible_user, valid_from, file_path, file_sha256)
    values (%L, 'ibs_regular', 'sim', '11222333', 'raiz', 'outro', 'x x x', '2026-09-15', %L, '2027-01-01', %L, repeat('a',64))$q$,
    t.id('co_a'), t.id('owner@co_a'), t.id('co_b') || '/x.pdf'), 'check');
select t.throws('chave de evidência estabelecimento exige CNPJ válido',
  format($q$insert into public.tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
    origin_description, document_date, responsible_user, valid_from)
    values (%L, 'ibs_regular', 'sim', '11222333', 'estabelecimento', 'outro', 'x x x', '2026-09-15', %L, '2027-01-01')$q$,
    t.id('co_a'), t.id('owner@co_a')), 'key_format');

-- Classificação por tenant guarda IBS e CBS separados, com vigência própria.
select t.lives('classificação do tenant com CBS sim e IBS não identificado',
  format($q$insert into public.tax_tenant_classifications (tenant_id, cnpj, reference_date, classification,
     cbs_regular, cbs_valid_from) values (%L, '11222333000181', '2027-01-15', 'simples_com_ibs_cbs_regular', 'sim', '2027-01-01')$q$,
     t.id('co_a')));
select t.eq('IBS segue não identificado quando só há evidência de CBS',
  (select ibs_regular::text from public.tax_tenant_classifications where tenant_id = t.id('co_a')), 'nao_identificado');

-- Auditoria: cada operação da importação deixou registro com autor e papel.
select t.ok('criação auditada com autor e papel',
  exists (select 1 from public.tax_audit_logs where action = 'tax.import.create'
          and actor_id = t.id('owner@co_a') and actor_role = 'owner' and tenant_id = t.id('co_a')));
select t.ok('finalização auditada com o resumo',
  exists (select 1 from public.tax_audit_logs where action = 'tax.import.finalize' and after ? 'valid'));
select t.ok('cancelamento auditado',
  exists (select 1 from public.tax_audit_logs where action = 'tax.import.cancel'));
select t.ok('ações principais também no audit_log existente (tela Auditoria)',
  (select count(distinct action) from public.audit_log where action like 'tax.import.%') = 3);
select t.eq('toda importação tem registro de criação',
  (select count(*) from public.tax_imports i
    where not exists (select 1 from public.tax_audit_logs l where l.action = 'tax.import.create' and l.target_id = i.id::text)),
  0::bigint);
select t.ok('nenhum log sem autor', not exists (select 1 from public.tax_audit_logs where actor_id is null));
