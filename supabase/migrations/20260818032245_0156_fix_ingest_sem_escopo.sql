-- Migration 20260818032245 (0156_fix_ingest_sem_escopo) — exportada de supabase_migrations.schema_migrations
-- CORREÇÃO: rtc_apuracao_ingest_json chamava extincao_resumo(), que exige
-- in_scope() — ou seja, um usuário logado. Quem ingere é o WORKER, sob
-- service_role, sem usuário nenhum: a chamada morria em "forbidden" DEPOIS de
-- gravar os débitos, e o job voltaria como falho mesmo tendo feito o trabalho.
-- O resumo agora é calculado inline; a função com guarda continua existindo
-- para a tela, que aí sim tem usuário.
create or replace function rtc_apuracao_ingest_json(p_apuracao uuid, p_json jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid; v_comp date; g record; d jsonb; n int := 0;
        v_cred bigint; v_pis bigint; v_pag bigint; v_presc bigint; v_tipos text[];
        v_resumo jsonb;
begin
  select tenant_id, competencia into v_tenant, v_comp from rtc_apuracao where id = p_apuracao;
  if v_tenant is null then raise exception 'apuracao inexistente'; end if;

  delete from rtc_debito where apuracao_id = p_apuracao;

  for g in select * from (values
      ('apuracaoCorrente','corrente'),
      ('apuracaoAjuste','ajuste'),
      ('debitosExtemporaneos','extemporaneo')) as t(chave, grupo)
  loop
    for d in select * from jsonb_array_elements(coalesce(p_json->g.chave->'debitos','[]'::jsonb)) loop
      select coalesce(sum((c->>'valorCreditoUtilizadoPrincipal')::numeric),0)*100 into v_cred
      from jsonb_array_elements(case jsonb_typeof(d->'formasExtincao'->'creditosCBS')
             when 'array' then d->'formasExtincao'->'creditosCBS'
             when 'object' then jsonb_build_array(d->'formasExtincao'->'creditosCBS')
             else '[]'::jsonb end) c;

      select coalesce(sum((c->>'valorCreditoUtilizado')::numeric),0)*100 into v_pis
      from jsonb_array_elements(case jsonb_typeof(d->'formasExtincao'->'creditosPISCOFINS')
             when 'array' then d->'formasExtincao'->'creditosPISCOFINS'
             when 'object' then jsonb_build_array(d->'formasExtincao'->'creditosPISCOFINS')
             else '[]'::jsonb end) c;

      select coalesce(sum((c->>'valorDarfUtilizadoPrincipal')::numeric),0)*100,
             coalesce(array_agg(distinct c->>'tipoPagamento') filter (where c->>'tipoPagamento' is not null),'{}')
        into v_pag, v_tipos
      from jsonb_array_elements(case jsonb_typeof(d->'formasExtincao'->'pagamentosCBS')
             when 'array' then d->'formasExtincao'->'pagamentosCBS'
             when 'object' then jsonb_build_array(d->'formasExtincao'->'pagamentosCBS')
             else '[]'::jsonb end) c;

      v_presc := coalesce((d->'formasExtincao'->'prescricao'->>'valorPrescrito')::numeric,0)*100;

      insert into rtc_debito (apuracao_id, tenant_id, grupo, competencia,
        modelo_dfe, numero_dfe, chave_dfe, emitido_em, autorizado_em, registrado_em,
        ni_emitente, ni_adquirente, cbs_total_cents, cbs_extinto_cents,
        cbs_nao_extinto_cents, situacao, ext_credito_cbs_cents,
        ext_credito_piscofins_cents, ext_pagamento_cents, ext_prescricao_cents,
        tipos_pagamento, payload)
      values (p_apuracao, v_tenant, g.grupo::apuracao_grupo,
        to_date(coalesce(d->>'dataApuracao', to_char(v_comp,'YYYYMM')),'YYYYMM'),
        d->>'modeloDfe', d->>'numeroDfe', d->>'chaveDfe',
        (d->>'dataDfeEmissao')::timestamptz, (d->>'dataDfeAutorizacao')::timestamptz,
        (d->>'dataDfeRegistro')::timestamptz,
        so_digitos(d->>'niEmitente'), so_digitos(d->>'niAdquirente'),
        round(coalesce((d->>'valorCBSTotal')::numeric,0)*100),
        round(coalesce((d->>'valorCBSExtinto')::numeric,0)*100),
        round(coalesce((d->>'valorCBSNaoExtinto')::numeric,0)*100),
        (case lower(coalesce(d->>'situacaoDebito',''))
           when 'aguardando processamento' then 'aguardando_processamento'
           when 'não extinto' then 'nao_extinto' when 'nao extinto' then 'nao_extinto'
           when 'extinto parcial' then 'extinto_parcial'
           when 'extinto total' then 'extinto_total'
           when 'cancelado' then 'cancelado' end)::debito_situacao,
        round(v_cred), round(v_pis), round(v_pag), round(v_presc), v_tipos, d);
      n := n + 1;
    end loop;
  end loop;

  -- resumo calculado aqui dentro, sem depender de guarda de usuário
  select jsonb_build_object(
    'debito_total_cents', coalesce(sum(cbs_total_cents),0),
    'extinto_cents', coalesce(sum(cbs_extinto_cents),0),
    'ainda_devido_cents', coalesce(sum(cbs_nao_extinto_cents),0),
    'por_credito_cbs_cents', coalesce(sum(ext_credito_cbs_cents),0),
    'por_credito_piscofins_cents', coalesce(sum(ext_credito_piscofins_cents),0),
    'por_pagamento_cents', coalesce(sum(ext_pagamento_cents),0),
    'documentos', count(*),
    'extemporaneos_cents', coalesce(sum(cbs_total_cents) filter (where grupo='extemporaneo'),0))
    into v_resumo
  from rtc_debito where apuracao_id = p_apuracao;

  update rtc_apuracao set
    status='disponivel', recebido_em=now(), download_em=now(), tiquete_download=null,
    resultado_cents=(select coalesce(sum(cbs_total_cents),0) from rtc_debito
                     where apuracao_id=p_apuracao and grupo='corrente'),
    natureza_resultado = case when (select coalesce(sum(cbs_total_cents),0) from rtc_debito
                                    where apuracao_id=p_apuracao and grupo='corrente') > 0
                              then 'devedor'::apuracao_natureza else 'neutro'::apuracao_natureza end,
    situacao = apuracao_situacao_em(v_comp),
    payload = p_json
  where id = p_apuracao;

  return jsonb_build_object('debitos', n, 'resumo', v_resumo);
end $$;
revoke execute on function rtc_apuracao_ingest_json(uuid,jsonb) from public, anon, authenticated;
grant execute on function rtc_apuracao_ingest_json(uuid,jsonb) to service_role;
