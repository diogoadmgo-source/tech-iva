-- Migration 20260818031952 (0153_checklist_prontidao) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- CHECKLIST DE PRONTIDÃO — o que a empresa precisa ter pronto
-- Fonte: Glossário RTC v.III (maio/2026) + Manual RTC v.I (jan/2026)
-- ============================================================================
-- O glossário trouxe um detalhe operacional que não aparece em lugar nenhum e
-- que custa dinheiro se passar batido:
--
--   "PIX: O pagamento das devoluções, sejam ressarcimento ou transferência,
--    será realizado na conta PIX do contribuinte, que deve estar ATIVA e ter
--    como CHAVE o CNPJ/CPF do contribuinte."
--
-- Ou seja: sem chave Pix igual ao CNPJ, a empresa NÃO RECEBE ressarcimento nem
-- transferência. E "Transferência" é automática — ocorre quando houve pagamento
-- a maior por split, RAD ou pagamento do contribuinte, sem pedido, em até 3 dias
-- úteis. É dinheiro voltando sozinho, que simplesmente não chega se a chave não
-- existir. Isso é um item de checklist, não um detalhe técnico.

create table prontidao_item (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  chave       text not null,
  concluido   boolean not null default false,
  concluido_em timestamptz,
  concluido_por uuid,
  observacao  text,
  unique (tenant_id, chave)
);
alter table prontidao_item enable row level security;
create policy prontidao_select on prontidao_item for select to authenticated using (in_scope(tenant_id));
grant select on prontidao_item to authenticated;
grant all on prontidao_item to service_role;

create trigger audit_prontidao after insert or update or delete on prontidao_item
  for each row execute function audit_row();

create or replace function marcar_prontidao(p_tenant uuid, p_chave text, p_concluido boolean,
                                            p_observacao text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;
  insert into prontidao_item (tenant_id, chave, concluido, concluido_em, concluido_por, observacao)
  values (p_tenant, p_chave, p_concluido, case when p_concluido then now() end, auth.uid(), p_observacao)
  on conflict (tenant_id, chave) do update
    set concluido = excluded.concluido,
        concluido_em = case when excluded.concluido then now() end,
        concluido_por = auth.uid(), observacao = excluded.observacao;
  perform log_audit(p_tenant, 'prontidao.marcar', 'prontidao_item', p_chave, null,
                    jsonb_build_object('concluido', p_concluido));
end $$;
grant execute on function marcar_prontidao(uuid,text,boolean,text) to authenticated;

-- O checklist em si. Cada item tem base documental — nada de conselho inventado.
create or replace function checklist_prontidao(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_regime regime_kind; v_itens jsonb;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select regime into v_regime from counterparties where false;   -- placeholder
  v_regime := coalesce((select (settings->>'regime_declarado')::regime_kind
                        from tenants where id = p_tenant), 'desconhecido');

  v_itens := jsonb_build_array(
    jsonb_build_object(
      'chave','pix_cnpj',
      'titulo','Chave Pix igual ao CNPJ da empresa, ativa',
      'porque','Ressarcimentos e transferências de CBS são pagos na conta Pix do contribuinte, e a chave precisa ser o CNPJ. Sem isso, o dinheiro não chega — e a Transferência é automática, sem pedido seu.',
      'fonte','Glossário RTC v.III (maio/2026), verbetes PIX e Transferência',
      'criticidade','alta'),
    jsonb_build_object(
      'chave','conta_govbr',
      'titulo','Conta gov.br nível prata ou ouro do responsável',
      'porque','Sem esse nível não se acessa os serviços autenticados do Portal, incluindo a Apuração Assistida.',
      'fonte','Comunicado do Ambiente Beta, seção 3.1',
      'criticidade','alta'),
    jsonb_build_object(
      'chave','emissor_cst',
      'titulo','Emissor configurado com CST e cClassTrib corretos',
      'porque','O documento fiscal passou a ser a confissão de dívida. Erro de classificação vira erro de apuração, e a correção é emitir outro documento.',
      'fonte','Manual RTC v.I, "o documento fiscal passará a ser a confissão de dívida"',
      'criticidade','alta'),
    jsonb_build_object(
      'chave','conformidade_2026',
      'titulo','Adesão ao Programa Nacional de Conformidade',
      'porque','Quem aderir e corrigir inconsistências até o fim do exercício não fica sujeito às sanções previstas.',
      'fonte','CGIBS, Programa Nacional de Conformidade Tributária',
      'criticidade','media'),
    jsonb_build_object(
      'chave','meio_pagamento',
      'titulo','Meio de pagamento informado nas parcelas a receber',
      'porque','Só seis arranjos entram na Fase 1 do split. Sem saber o meio, a projeção de caixa perde precisão.',
      'fonte','Manual de Operações do Split Payment, seção 1.2',
      'criticidade','media'),
    jsonb_build_object(
      'chave','credencial_api',
      'titulo','Credencial da API da Receita cadastrada',
      'porque','É o que permite comparar a nossa apuração com a da Receita automaticamente.',
      'fonte','Manual RTC v.I, "Gerar Credencial de acesso para API"',
      'criticidade','media')
  );

  -- itens que dependem do regime
  if v_regime = 'simples' then
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'chave','simulacao_regime',
      'titulo','Comparar Simples com regime regular',
      'porque','A Apuração Assistida já exibe seus resultados como se você fosse do regime regular, justamente para apoiar essa análise. Vale conferir antes da janela de opção.',
      'fonte','Comunicado do Ambiente Beta, seção 4.1.1',
      'criticidade','alta'));
  end if;

  return jsonb_build_object(
    'itens', (select jsonb_agg(i || jsonb_build_object(
                'concluido', coalesce(p.concluido,false),
                'concluido_em', p.concluido_em,
                'observacao', p.observacao))
              from jsonb_array_elements(v_itens) i
              left join prontidao_item p on p.tenant_id = p_tenant and p.chave = i->>'chave'),
    'total', jsonb_array_length(v_itens),
    'concluidos', (select count(*) from prontidao_item
                   where tenant_id = p_tenant and concluido
                     and chave in (select i->>'chave' from jsonb_array_elements(v_itens) i)));
end $$;
grant execute on function checklist_prontidao(uuid) to authenticated;

insert into platform_notices (key, scope, severity, title, body) values
('pix_cnpj_obrigatorio', 'apuracao', 'warning',
 'Sem chave Pix igual ao CNPJ, o dinheiro não volta',
 'Ressarcimentos e transferências de CBS são pagos na conta Pix do contribuinte, e a chave precisa ser o próprio '||
 'CNPJ, com a conta ativa (Glossário RTC v.III). A Transferência é automática — ocorre em até três dias úteis '||
 'quando houver pagamento a maior por split payment, recolhimento pelo adquirente ou pagamento do contribuinte, '||
 'sem que você precise pedir. Se a chave não existir, esse dinheiro simplesmente não chega.'),
('periodo_ajuste_divergencia', 'apuracao', 'info',
 'Prazo do período de ajuste: documentos oficiais divergem',
 'O Manual RTC (jan/2026) descreve o período de ajuste indo até o dia 25 do mês seguinte, enquanto o Glossário '||
 'RTC v.III (maio/2026) define como "os 15 dias após o mês de apuração". Enquanto a Receita não uniformiza, '||
 'adotamos o prazo mais longo para não sugerir que a janela fechou antes da hora. Confirme com seu contador '||
 'antes de contar com o prazo maior.')
on conflict (key) do nothing;
