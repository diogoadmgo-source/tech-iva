-- 0234_ingestao_nao_entendeu_e_erro.sql
--
-- ATENÇÃO: aplicar só com o código da Tarefa 6 (commit ae1b6eb ou posterior)
-- já publicado. Ordem completa: docs/fluxo-de-trabalho.md.
--
-- rtc_apuracao_ingest_json lê o arquivo que a Receita devolve e grava os
-- débitos. Foi escrita a partir do manual e NUNCA rodou sobre um arquivo real.
-- Ela trocava "não entendi" por zero em três lugares:
--   - grupo ausente virava lista vazia: coalesce(p_json->grupo->'debitos','[]');
--   - débito sem valor total virava R$ 0,00: coalesce((d->>'valorCBSTotal')::numeric,0);
--   - no fim, marcava a apuração como 'disponivel', resultado = soma ou 0,
--     natureza 'neutro'.
-- Se o arquivo real tiver outro formato (outro nome de grupo, "debitos" que não
-- é lista, valor com outro nome), a apuração aparecia como disponível com
-- R$ 0,00 — um número que a Receita nunca disse.
--
-- Agora, ANTES de apagar ou gravar qualquer coisa, a função confere o arquivo
-- e para com erro explícito, em português, quando:
--   (a) nenhum dos grupos que ela sabe ler veio preenchido (a mensagem diz
--       quais procurou e quais chaves o arquivo trouxe);
--   (b) um grupo veio, mas o "debitos" dele não é uma lista;
--   (c) algum débito não tem o valor total da CBS ("valorCBSTotal") como
--       número. Aceita número JSON ou texto só com dígitos e ponto decimal
--       ("10.00") — o que a conversão de antes já aceitava. "1.234,56" é erro.
-- Grupo presente com lista de débitos VAZIA continua valendo: é o resultado
-- legítimo "nenhum débito neste grupo". Grupo que vem como null conta como
-- ausente.
--
-- Por que erro não perde nada: o aplicativo grava o arquivo bruto
-- (rtc_apuracao.payload) ANTES de chamar esta função (processarApuracao em
-- src/lib/rtc-apuracao.server.ts). Com o erro, a transação desfaz tudo o que a
-- função fez, a linha vai para status 'erro' com a mensagem na coluna erro, e o
-- arquivo fica guardado. Depois de ajustar a função ao formato real, basta rodar
-- a ingestão de novo sobre o arquivo guardado, no SQL Editor:
--   select rtc_apuracao_ingest_json(id, payload) from rtc_apuracao where id = '<id>';
-- (O botão "Reprocessar retorno" não pega essa linha: ela já tem arquivo, e
-- rtc_apuracao_pendentes_download só lista linhas sem arquivo.)
--
-- Fora da conferência, nada muda: mesma assinatura, mesmo tipo devolvido
-- (jsonb), mesmo corpo. A única linha tocada no corpo é a do valor total, que
-- perde o coalesce(...,0) — a conferência garante que o valor existe.
--
-- Fora deste escopo (anotado no relatório da rodada): valorCBSExtinto e
-- valorCBSNaoExtinto continuam com coalesce(...,0); grupo ausente enquanto
-- outro grupo veio continua sendo lido como "sem débitos".
--
-- Permissões conferidas em produção em 25/09 (role_routine_grants): postgres
-- (dono) e service_role. create or replace mantém as permissões; reemitidas
-- mesmo assim, iguais.

create or replace function public.rtc_apuracao_ingest_json(p_apuracao uuid, p_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_tenant uuid; v_comp date; g record; d jsonb; n int := 0;
        v_cred bigint; v_pis bigint; v_pag bigint; v_presc bigint; v_tipos text[];
        v_resumo jsonb;
        v_grupos text[] := array['apuracaoCorrente','apuracaoAjuste','debitosExtemporaneos'];
        v_chave text; v_ruim record;
begin
  select tenant_id, competencia into v_tenant, v_comp from rtc_apuracao where id = p_apuracao;
  if v_tenant is null then raise exception 'apuracao inexistente'; end if;

  -- Conferência do arquivo ANTES de tocar em qualquer coisa. Resposta que não
  -- se entende é erro explícito, nunca zero.

  -- (a) nenhum grupo conhecido veio preenchido
  if not exists (select 1 from unnest(v_grupos) k(chave)
                  where coalesce(jsonb_typeof(p_json->k.chave), 'null') <> 'null') then
    raise exception 'Não entendemos o arquivo da Receita: nenhum dos grupos que sabemos ler veio preenchido (procuramos: %). Nada foi lançado; o arquivo ficou guardado para reprocessar. O arquivo trouxe: %.',
      array_to_string(v_grupos, ', '),
      case when jsonb_typeof(p_json) = 'object'
           then coalesce((select string_agg(k, ', ')
                            from (select left(k, 30) as k from jsonb_object_keys(p_json) k limit 8) s),
                         'nenhuma chave')
           else coalesce('um valor do tipo ' || jsonb_typeof(p_json), 'nada') end;
  end if;

  -- (b) grupo presente com "debitos" que não é lista
  foreach v_chave in array v_grupos loop
    if coalesce(jsonb_typeof(p_json->v_chave), 'null') <> 'null'
       and jsonb_typeof(p_json->v_chave->'debitos') is distinct from 'array' then
      raise exception 'Não entendemos o arquivo da Receita: no grupo "%", o campo "debitos" deveria ser uma lista e veio %. Nada foi lançado; o arquivo ficou guardado para reprocessar.',
        v_chave, coalesce('do tipo ' || jsonb_typeof(p_json->v_chave->'debitos'), 'ausente');
    end if;
  end loop;

  -- (c) débito sem o valor total da CBS como número
  select k.chave, e.pos, count(*) over () as total,
         coalesce(left((e.d->'valorCBSTotal')::text, 40), 'ausente') as valor
    into v_ruim
    from unnest(v_grupos) with ordinality k(chave, ord)
    cross join lateral jsonb_array_elements(
           case when jsonb_typeof(p_json->k.chave->'debitos') = 'array'
                then p_json->k.chave->'debitos' else '[]'::jsonb end) with ordinality e(d, pos)
   where not coalesce(
           jsonb_typeof(e.d->'valorCBSTotal') = 'number'
           or (jsonb_typeof(e.d->'valorCBSTotal') = 'string'
               and e.d->>'valorCBSTotal' ~ '^-?[0-9]+(\.[0-9]+)?$'),
           false)
   order by k.ord, e.pos
   limit 1;
  if found then
    raise exception 'Não entendemos o arquivo da Receita: % débito(s) sem o valor total da CBS ("valorCBSTotal") como número. O primeiro é o de posição % no grupo "%" (veio: %). Nada foi lançado; o arquivo ficou guardado para reprocessar.',
      v_ruim.total, v_ruim.pos, v_ruim.chave, v_ruim.valor;
  end if;

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
        -- sem coalesce: a conferência (c) garante que o valor total existe
        round((d->>'valorCBSTotal')::numeric*100),
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
end $function$;

revoke execute on function public.rtc_apuracao_ingest_json(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rtc_apuracao_ingest_json(uuid, jsonb) to service_role;
