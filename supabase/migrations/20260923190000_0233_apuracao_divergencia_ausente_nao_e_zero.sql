-- 0233_apuracao_divergencia_ausente_nao_e_zero.sql
--
-- apuracao_divergencia fazia coalesce(v_receita.debitos_cents, 0) na diferença
-- e no "divergente". Nenhuma rotina grava rtc_apuracao.debitos_cents (conferido
-- em 23/09: nem rtc_apuracao_ingest_json, nem rtc_apuracao_upsert, nem o código
-- do aplicativo), então TODA apuração disponível chegava com o débito da Receita
-- nulo, virava zero aqui, e a tela dizia: "Débito apurado pela Receita R$ 0,00",
-- divergência = o nosso cálculo inteiro, "Calculamos mais do que a Receita
-- apurou". Nada disso era verdade: a Receita não tinha informado o total.
--
-- Agora: sem o débito da Receita, diferenca_cents e divergente são NULOS. A
-- tela mostra "—" e diz que não dá para comparar.
--
-- O tipo devolvido (jsonb) e os argumentos não mudam: create or replace basta,
-- sem drop, e as permissões ficam. Reemitidas mesmo assim, iguais às de antes
-- (authenticated, service_role; postgres é o dono — conferido em 23/09).
--
-- Fora deste escopo (precisa decisão, ver docs/auditoria/2026-09-23-zeros-por-falta.md):
-- qual número da Receita deve entrar na comparação (resultado_cents, soma de
-- rtc_debito, ...) e o nosso lado (soma de invoices.cbs_cents, que tem
-- default 0 — item 12 da auditoria).

create or replace function public.apuracao_divergencia(p_tenant uuid, p_competencia date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare v_receita rtc_apuracao; v_nosso bigint;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;

  select * into v_receita from rtc_apuracao
   where tenant_id=p_tenant and competencia=date_trunc('month',p_competencia)::date
     and status='disponivel' order by recebido_em desc limit 1;

  select coalesce(sum(i.cbs_cents),0) into v_nosso
    from invoices i
   where i.tenant_id=p_tenant and i.direction='out'
     and date_trunc('month', i.issued_at) = date_trunc('month', p_competencia);

  if v_receita.id is null then
    return jsonb_build_object('disponivel', false, 'nosso_debito_cents', v_nosso,
                              'mensagem', 'Apuração da Receita ainda não consultada para esta competência');
  end if;

  -- Ausente não é zero: sem o débito da Receita, diferença e veredito ficam nulos
  -- (jsonb_build_object grava null do SQL como null do JSON).
  return jsonb_build_object(
    'disponivel', true,
    'competencia', v_receita.competencia,
    'receita_debito_cents', v_receita.debitos_cents,
    'nosso_debito_cents', v_nosso,
    'diferenca_cents', v_receita.debitos_cents - v_nosso,
    'divergente', abs(v_receita.debitos_cents - v_nosso) > 100,
    'recebido_em', v_receita.recebido_em);
end $function$;

revoke all on function public.apuracao_divergencia(uuid, date) from public, anon;
grant execute on function public.apuracao_divergencia(uuid, date) to authenticated, service_role;
