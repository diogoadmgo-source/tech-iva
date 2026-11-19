-- 0260: cota por API, aviso v2 do webhook, ingestão v2 e registro de DARF.
set search_path = public, extensions;

create temp table t as
  with p as (insert into tenants (path, level, kind, name) values ('p', 0, 'platform', 'Plataforma') returning id)
  select id as plat from p;
insert into tenants (parent_id, path, level, kind, name, cnpj)
  select plat, 'p.e', 1, 'company', 'Empresa', '12345678000195' from t;
alter table t add column emp uuid;
update t set emp = (select id from tenants where name = 'Empresa');

insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'dono@x'),
                              ('00000000-0000-0000-0000-00000000000b', 'leitor@x');
insert into memberships select '00000000-0000-0000-0000-00000000000a', emp, 'owner' from t;
insert into memberships select '00000000-0000-0000-0000-00000000000b', emp, 'viewer' from t;

-- 1. cota: 4 por API, independentes
do $$
declare e uuid := (select emp from t); r jsonb; i int;
begin
  for i in 1..4 loop
    r := rtc_apuracao_solicitar(e, current_date, 'manual', 'recolhimentos', 2::smallint);
    assert (r->>'ok')::boolean, format('abertura %s de recolhimentos deveria passar: %s', i, r);
  end loop;
  r := rtc_apuracao_solicitar(e, current_date, 'manual', 'recolhimentos', 2::smallint);
  assert not (r->>'ok')::boolean, '5a de recolhimentos deveria ser recusada';
  assert r->>'motivo' like '%4 consultas de recolhimentos%', r->>'motivo';
  -- débitos têm as próprias 4
  r := rtc_apuracao_solicitar(e, current_date, 'manual', 'debitos', 2::smallint);
  assert (r->>'ok')::boolean, 'débitos não podem disputar a cota dos recolhimentos';
  -- v1 continua na tabela antiga
  r := rtc_apuracao_solicitar(e, current_date, 'manual', 'debitos', 1::smallint);
  assert (r->>'ok')::boolean;
  assert (select solicitacoes from rtc_api_quota where cnpj8 = '12345678') = 1, 'v1 deveria debitar só a cota antiga';
  -- estorno devolve a da API certa
  perform rtc_quota_estornar_v2('12345678000195', 'recolhimentos');
  assert (select solicitacoes from rtc_api_quota_v2 where cnpj8 = '12345678' and recurso = 'recolhimentos') = 3;
  -- automático nunca gasta a última
  delete from rtc_api_quota_v2;
  for i in 1..3 loop perform rtc_quota_take_v2('12345678', 'pagamentos', 'automatico'); end loop;
  assert not (rtc_quota_take_v2('12345678', 'pagamentos', 'automatico')->>'permitido')::boolean;
  assert (rtc_quota_take_v2('12345678', 'pagamentos', 'manual')->>'permitido')::boolean;
end $$;

-- 2. aviso v2 do webhook: CONCLUIDA mantém 'solicitada' sem erro; erro marca erro
do $$
declare e uuid := (select emp from t); a uuid; b uuid; r jsonb;
begin
  insert into rtc_apuracao (tenant_id, competencia, webhook_ref, recurso, api_versao, tiquete_solicitacao)
    values (e, current_date, repeat('a', 48), 'recolhimentos', 2, 'TQ-1') returning id into a;
  r := rtc_apuracao_receber_tiquete(repeat('a', 48), '{"tiqueteSolicitacao":"TQ-1","situacao":"CONCLUIDA"}');
  assert (r->>'ok')::boolean and (r->>'concluida')::boolean, r::text;
  assert (select status = 'solicitada' and erro is null and webhook_ref is null and webhook_recebido_em is not null
            from rtc_apuracao where id = a), 'aviso CONCLUIDA deveria deixar a linha pronta para pedir o link';

  insert into rtc_apuracao (tenant_id, competencia, webhook_ref, recurso, api_versao)
    values (e, current_date, repeat('b', 48), 'debitos', 2) returning id into b;
  perform rtc_apuracao_receber_tiquete(repeat('b', 48), '{"codigoErro":"ERRO_INTERNO","mensagemErro":"falhou"}');
  assert (select status = 'erro' and erro = 'falhou' from rtc_apuracao where id = b);

  -- v1 segue o caminho antigo
  insert into rtc_apuracao (tenant_id, competencia, webhook_ref, recurso, api_versao)
    values (e, current_date, repeat('c', 48), 'debitos', 1);
  perform rtc_apuracao_receber_tiquete(repeat('c', 48), '{"tiqueteDownload":"D-1"}');
  assert (select status = 'tiquete_recebido' and tiquete_download = 'D-1' from rtc_apuracao where webhook_ref is null and api_versao = 1);
end $$;

-- 3. ingestão v2: upsert incremental, linha antiga não sobrescreve nova
do $$
declare e uuid := (select emp from t); a uuid; a2 uuid; r jsonb;
begin
  insert into rtc_apuracao (tenant_id, competencia, recurso, api_versao) values (e, current_date, 'debitos', 2) returning id into a;
  r := rtc_cbs_v2_ingerir(a, '[{"pa":"08/2026","chave":"K1","origem":0,"documento":55,"atualizacao":"2026-08-14T12:00:00Z",
       "apurado_cents":4000,"excedente_cents":0,"inexigivel_cents":0,"suspenso_cents":0,"pgto_antecipado_cents":500,
       "extinto_cents":0,"saldo_devedor_cents":3500}]');
  assert (r->>'linhas')::int = 1;
  assert (select status from rtc_apuracao where id = a) = 'disponivel';
  assert (select pa = date '2026-08-01' and pgto_antecipado_cents = 500 from rtc_cbs_debito_v2 where chave = 'K1');

  insert into rtc_apuracao (tenant_id, competencia, recurso, api_versao) values (e, current_date, 'debitos', 2) returning id into a2;
  -- versão mais antiga do mesmo lançamento: ignorada
  perform rtc_cbs_v2_ingerir(a2, '[{"pa":"08/2026","chave":"K1","origem":0,"documento":55,"atualizacao":"2026-08-10T00:00:00Z",
       "apurado_cents":1,"excedente_cents":0,"inexigivel_cents":0,"suspenso_cents":0,"pgto_antecipado_cents":0,
       "extinto_cents":0,"saldo_devedor_cents":1}]');
  assert (select saldo_devedor_cents from rtc_cbs_debito_v2 where chave = 'K1') = 3500, 'linha antiga sobrescreveu a nova';
  -- versão nova: atualiza
  perform rtc_cbs_v2_ingerir(a2, '[{"pa":"08/2026","chave":"K1","origem":0,"documento":55,"atualizacao":"2026-08-20T00:00:00Z",
       "apurado_cents":4000,"excedente_cents":0,"inexigivel_cents":0,"suspenso_cents":0,"pgto_antecipado_cents":0,
       "extinto_cents":4000,"saldo_devedor_cents":0}]');
  assert (select saldo_devedor_cents = 0 and apuracao_id = a2 from rtc_cbs_debito_v2 where chave = 'K1');
  assert (select count(*) from rtc_cbs_debito_v2) = 1;

  -- recolhimentos
  insert into rtc_apuracao (tenant_id, competencia, recurso, api_versao) values (e, current_date, 'recolhimentos', 2) returning id into a;
  perform rtc_cbs_v2_ingerir(a, '[{"data_arrecadacao":"2026-08-27","numero_darf":"20260827000000001","tipo":1,
       "sequencial":1,"pa":"08/2026","vencimento":"2026-09-20","ni_fornecedor":"98765432000199","chave_dfe":"3526",
       "principal_cents":10000,"multa_cents":1000,"juros_cents":500,"total_cents":11500}]');
  perform rtc_cbs_v2_ingerir(a, '[{"data_arrecadacao":"2026-08-27","numero_darf":"20260827000000001","tipo":1,
       "sequencial":1,"pa":"08/2026","vencimento":"2026-09-20","ni_fornecedor":"98765432000199","chave_dfe":"3526",
       "principal_cents":10000,"multa_cents":1000,"juros_cents":500,"total_cents":11500}]');
  assert (select count(*) = 1 and sum(total_cents) = 11500 from rtc_cbs_pagamento where recurso = 'recolhimentos'), 'repetir o arquivo não pode duplicar';

  -- créditos com linhas: recusa explícita; lista vazia fecha a apuração
  insert into rtc_apuracao (tenant_id, competencia, recurso, api_versao) values (e, current_date, 'creditos', 2) returning id into a;
  perform rtc_cbs_v2_ingerir(a, '[]');
  assert (select status from rtc_apuracao where id = a) = 'disponivel';
  begin
    perform rtc_cbs_v2_ingerir(a, '[{"x":1}]');
    assert false, 'créditos com linhas deveriam ser recusados';
  exception when raise_exception then null;
  end;
  -- período fora do formato é erro, não data inventada
  begin
    perform rtc_pa_data('2026-08');
    assert false;
  exception when raise_exception then null;
  end;
  -- v1 não entra aqui
  insert into rtc_apuracao (tenant_id, competencia, recurso, api_versao) values (e, current_date, 'debitos', 1) returning id into a;
  begin
    perform rtc_cbs_v2_ingerir(a, '[]');
    assert false;
  exception when raise_exception then null;
  end;
end $$;

-- 4. DARF: registro e permissão
do $$
declare e uuid := (select emp from t); d uuid;
begin
  d := rtc_cbs_darf_registrar(e, '00000000-0000-0000-0000-00000000000a',
    '{"tipo":"pcont","pa":"08/2026","opcao_pagamento":"PAGAMENTO_TOTAL","pedido":{"pa":"08/2026"},
      "http_status":200,"cd_retorno":"DARF_GERADO","gerado":true,"codigo_barras":"858","data_maxima":"2026-08-13",
      "principal_cents":150075,"multa_cents":2510,"juros_cents":1025,"total_cents":153610,"dados_invalidos":[]}');
  assert (select total_cents = 153610 and gerado from rtc_cbs_darf where id = d);
  assert exists (select 1 from audit_log where action = 'darf.gerar' and entity_id = d::text);
end $$;

-- leitura e permissão como usuário logado
grant select on t to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
do $$ begin
  assert rtc_pode_emitir_darf((select emp from t)), 'dono deveria poder gerar DARF';
  assert (select count(*) from rtc_cbs_darf) = 1, 'dono deveria ler os DARFs da empresa';
  assert (select count(*) from rtc_cbs_pagamento) = 1;
  assert (rtc_quota_status_v2((select emp from t))->'pagamentos'->>'usadas')::int = 4;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', false);
do $$ begin
  assert not rtc_pode_emitir_darf((select emp from t)), 'leitor não pode gerar DARF';
  assert (select count(*) from rtc_cbs_darf) = 1, 'leitor do escopo ainda lê';
end $$;
-- escrita direta é barrada para authenticated
do $$ begin
  begin
    insert into rtc_cbs_darf (tenant_id, tipo, opcao_pagamento, pedido, cd_retorno)
      values ((select emp from t), 'pcont', 'PAGAMENTO_TOTAL', '{}', 'X');
    assert false, 'authenticated não pode inserir DARF';
  exception when insufficient_privilege then null;
  end;
  begin
    perform rtc_cbs_darf_registrar((select emp from t), null, '{}');
    assert false, 'authenticated não pode chamar o registro';
  exception when insufficient_privilege then null;
  end;
  begin
    perform rtc_quota_take_v2('12345678', 'debitos', 'manual');
    assert false, 'authenticated não pode debitar cota';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ff"}', false);
do $$ begin
  assert (select count(*) from rtc_cbs_darf) = 0, 'fora do escopo não lê nada';
end $$;
reset role;
\echo OK 10_cota_aviso_ingestao
