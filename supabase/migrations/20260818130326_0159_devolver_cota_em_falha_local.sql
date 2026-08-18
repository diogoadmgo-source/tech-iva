-- Migration 20260818130326 (0159_devolver_cota_em_falha_local) — exportada de supabase_migrations.schema_migrations
-- BUG encontrado no primeiro teste real: a cota é debitada ANTES da chamada
-- externa (correto, para não estourar o limite da Receita), mas se a execução
-- falha ANTES de sair da nossa máquina — credencial ilegível, chave ausente,
-- webhook não configurado — a cota some sem que nenhuma consulta tenha sido
-- feita. O cliente perde o direito do dia por um erro nosso.
--
-- Também sobrava a solicitação em 'solicitada' para sempre, sem erro registrado,
-- porque a falha acontecia fora do trecho que marca o erro.
--
-- Correção: uma função que marca a falha E devolve a cota, usada sempre que o
-- erro for LOCAL. Quando o erro vier da Receita (ela recebeu e recusou), a cota
-- NÃO é devolvida — porque a chamada aconteceu de verdade.
create or replace function rtc_apuracao_falhar(p_id uuid, p_erro text,
                                               p_devolver_cota boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_tenant uuid; v_cnpj text; v_devolvida boolean := false;
begin
  select a.tenant_id, t.cnpj into v_tenant, v_cnpj
  from rtc_apuracao a join tenants t on t.id = a.tenant_id
  where a.id = p_id;
  if v_tenant is null then raise exception 'apuracao inexistente'; end if;

  update rtc_apuracao
     set status = 'erro', erro = left(p_erro, 1000), webhook_ref = null
   where id = p_id;

  if p_devolver_cota then
    update rtc_api_quota
       set solicitacoes = greatest(solicitacoes - 1, 0)
     where cnpj8 = left(regexp_replace(coalesce(v_cnpj,''),'\D','','g'), 8)
       and dia = current_date and solicitacoes > 0;
    v_devolvida := found;
  end if;

  perform log_audit(v_tenant, 'apuracao.falha', 'rtc_apuracao', p_id::text, null,
                    jsonb_build_object('erro', left(p_erro,300), 'cota_devolvida', v_devolvida));

  return jsonb_build_object('ok', true, 'cota_devolvida', v_devolvida);
end $$;
revoke execute on function rtc_apuracao_falhar(uuid,text,boolean) from public, anon, authenticated;
grant execute on function rtc_apuracao_falhar(uuid,text,boolean) to service_role;

-- Limpeza do que ficou pendurado nos testes de agora: nenhuma dessas solicitações
-- chegou à Receita, então as duas cotas voltam.
do $$
declare r record;
begin
  for r in select id from rtc_apuracao where status = 'solicitada' and tiquete_solicitacao is null
                                         and solicitado_em > now() - interval '2 hours'
  loop
    perform rtc_apuracao_falhar(r.id, 'Falha local antes da chamada à Receita (credencial ilegível)', true);
  end loop;
end $$;

select coalesce((select solicitacoes from rtc_api_quota
                 where cnpj8 = '23813386' and dia = current_date), 0) as cota_usada_agora;
