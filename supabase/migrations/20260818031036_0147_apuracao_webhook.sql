-- Migration 20260818031036 (0147_apuracao_webhook) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- WEBHOOK DA APURAÇÃO — o elo que faltava no fluxo de 3 passos
-- ============================================================================
-- Confirmado na documentação: a solicitação leva {"urlRetorno": "<webhook>"} e a
-- Receita NÃO devolve o tíquete na resposta — ela CHAMA nosso endereço depois,
-- entregando {tiqueteSolicitacao, tiqueteDownload}. O download usa o segundo.
--
-- Consequência de arquitetura: precisamos de um endereço público. E como ele é
-- público, precisa de um segredo por solicitação — senão qualquer um poderia
-- postar um tíquete falso e nos fazer baixar (ou registrar) o que não é nosso.

alter table rtc_apuracao
  add column if not exists tiquete_solicitacao text,
  add column if not exists tiquete_download text,
  add column if not exists webhook_recebido_em timestamptz;

-- webhook_ref: segredo aleatório por solicitação, viaja na URL de retorno.
-- Uso único: depois de recebido o tíquete, deixa de ser aceito.
create unique index if not exists rtc_apuracao_webhook_ref on rtc_apuracao (webhook_ref)
  where webhook_ref is not null;

create or replace function rtc_apuracao_solicitar(p_tenant uuid, p_competencia date,
                                                  p_origem text default 'manual')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_cnpj text; v_cota jsonb; v_ref text; v_id uuid;
begin
  select cnpj into v_cnpj from tenants where id = p_tenant;
  if v_cnpj is null then raise exception 'empresa sem CNPJ'; end if;

  -- cota debitada ANTES da chamada externa: melhor recusar aqui, com mensagem
  -- nossa, do que tomar 429 da Receita e o usuário achar que o sistema quebrou
  v_cota := rtc_quota_take(v_cnpj, 'solicitacao', p_origem);
  if not (v_cota->>'permitido')::boolean then
    return jsonb_build_object('ok', false, 'motivo', v_cota->>'motivo', 'cota', v_cota);
  end if;

  v_ref := encode(gen_random_bytes(24), 'hex');

  insert into rtc_apuracao (tenant_id, competencia, status, webhook_ref)
  values (p_tenant, date_trunc('month', p_competencia)::date, 'solicitada', v_ref)
  returning id into v_id;

  perform log_audit(p_tenant, 'apuracao.solicitar', 'rtc_apuracao', v_id::text, null,
                    jsonb_build_object('competencia', date_trunc('month',p_competencia)::date,
                                       'origem', p_origem, 'cota', v_cota));

  return jsonb_build_object('ok', true, 'id', v_id, 'webhook_ref', v_ref,
                            'cnpj8', left(regexp_replace(v_cnpj,'\D','','g'),8), 'cota', v_cota);
end $$;
revoke execute on function rtc_apuracao_solicitar(uuid,date,text) from public, anon, authenticated;
grant execute on function rtc_apuracao_solicitar(uuid,date,text) to service_role;

-- Chamado pelo webhook. Só aceita ref que existe, está aguardando e não expirou.
-- Falha silenciosa de propósito no retorno (ok=false sem detalhe): quem chama é
-- um endereço público, e não devemos ajudar quem estiver sondando.
create or replace function rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v rtc_apuracao;
begin
  select * into v from rtc_apuracao
   where webhook_ref = p_ref and status = 'solicitada'
     and solicitado_em > now() - interval '2 hours'
   for update;

  if v.id is null then
    return jsonb_build_object('ok', false);
  end if;

  update rtc_apuracao
     set tiquete_solicitacao = p_payload->>'tiqueteSolicitacao',
         tiquete_download    = coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete'),
         status = case when coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete') is null
                       then 'erro' else 'tiquete_recebido' end,
         erro = case when coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete') is null
                     then 'webhook sem tiquete de download' end,
         webhook_recebido_em = now(),
         webhook_ref = null            -- uso único: o segredo morre aqui
   where id = v.id;

  perform log_audit(v.tenant_id, 'apuracao.tiquete', 'rtc_apuracao', v.id::text, null,
                    jsonb_build_object('recebido_em', now()));

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function rtc_apuracao_receber_tiquete(text,jsonb) from public, anon, authenticated;
grant execute on function rtc_apuracao_receber_tiquete(text,jsonb) to service_role;

-- Fila para o worker: solicitações com tíquete pronto e ainda não baixadas
create or replace function rtc_apuracao_pendentes_download()
returns table (id uuid, tenant_id uuid, cnpj text, competencia date, tiquete text)
language sql stable security definer set search_path = public, extensions as $$
  select a.id, a.tenant_id, t.cnpj, a.competencia, a.tiquete_download
  from rtc_apuracao a join tenants t on t.id = a.tenant_id
  where a.status = 'tiquete_recebido' and a.tiquete_download is not null
    and a.webhook_recebido_em > now() - interval '24 hours'   -- o arquivo expira em 24h
  order by a.webhook_recebido_em;
$$;
revoke execute on function rtc_apuracao_pendentes_download() from public, anon, authenticated;
grant execute on function rtc_apuracao_pendentes_download() to service_role;

-- Solicitação que ficou sem retorno do webhook vira erro em vez de ficar pendurada
create or replace function rtc_apuracao_expirar_pendentes()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  update rtc_apuracao
     set status = 'erro', erro = 'A Receita não retornou o tíquete em 2 horas', webhook_ref = null
   where status = 'solicitada' and solicitado_em < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function rtc_apuracao_expirar_pendentes() from public, anon, authenticated;
grant execute on function rtc_apuracao_expirar_pendentes() to service_role;
