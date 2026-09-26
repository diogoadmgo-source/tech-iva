-- 0235_retorno_da_receita_registrado_e_24h.sql
--
-- APLICAR SÓ COM O CÓDIGO DO MESMO COMMIT PUBLICADO (ver docs/fluxo-de-trabalho.md).
--
-- Descoberta de 26/09/2026: a Receita NUNCA tinha chamado o nosso endereço de
-- retorno. O "retorno em 1 segundo com o mesmo tíquete" era o próprio código:
-- ele pegava o `tiquete` da resposta ao pedido — que o manual, Passo 2, chama
-- de "tíquete da solicitação" —, chamava esta função fingindo ser a Receita,
-- apagava o webhook_ref e tentava baixar com o comprovante errado. Os registros
-- de acesso provaram: em 24 horas, a única chamada a esta função foi a nossa,
-- 73 ms depois da resposta ao pedido. O código foi corrigido no mesmo commit.
--
-- Esta migração faz três coisas:
--
-- 1. Registra TODA chamada ao retorno em `rtc_webhook_recebido`, aceita ou não,
--    com o corpo bruto. Nunca mais ficamos sem ver o que a Receita mandou — nem
--    quando o endereço já foi usado, nem quando a janela passou. É também o que
--    pode salvar a consulta de 26/09: o webhook_ref dela foi apagado pelo código
--    antigo, mas se a Receita chamar, o comprovante de download fica guardado
--    aqui e pode ser ligado à linha à mão.
--
-- 2. A janela para aceitar o retorno sobe de 2 para 24 horas. O manual diz que
--    o arquivo fica disponível por 24 horas e não diz quanto a Receita demora
--    para prepará-lo. 2 horas era palpite.
--
-- 3. `rtc_apuracao_expirar_pendentes` passa a usar as mesmas 24 horas (hoje
--    nada a chama sozinho — não há pg_cron —, mas não pode desmentir a regra).
--
-- `create or replace` basta nas duas funções: assinatura e retorno não mudam.
-- Permissões reemitidas iguais às de 26/09: execute só para service_role
-- (postgres é o dono).

create table if not exists public.rtc_webhook_recebido (
  id          bigint generated always as identity primary key,
  ref         text,
  payload     jsonb,
  aceito      boolean not null default false,
  apuracao_id uuid references public.rtc_apuracao(id) on delete set null,
  recebido_em timestamptz not null default now()
);

create index if not exists rtc_webhook_recebido_recebido_em_idx
  on public.rtc_webhook_recebido (recebido_em desc);

comment on table public.rtc_webhook_recebido is
  'Toda chamada ao endereço de retorno da Receita, aceita ou não, com o corpo bruto. Só o servidor (service_role) lê e escreve.';

-- Sem política de RLS: ninguém além do service_role enxerga esta tabela.
alter table public.rtc_webhook_recebido enable row level security;
revoke all on table public.rtc_webhook_recebido from public, anon, authenticated;

create or replace function public.rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v public.rtc_apuracao;
  v_tiquete text;
  v_url     text;
  v_log     bigint;
BEGIN
  -- Primeiro registra, depois decide: a chamada fica guardada mesmo se for
  -- recusada logo abaixo.
  INSERT INTO public.rtc_webhook_recebido (ref, payload)
  VALUES (p_ref, p_payload)
  RETURNING id INTO v_log;

  SELECT * INTO v
    FROM public.rtc_apuracao
   WHERE webhook_ref = p_ref
     AND status = 'solicitada'
     AND solicitado_em > now() - interval '24 hours'
   FOR UPDATE;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_tiquete := coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete');
  v_url     := p_payload->>'urlAssinada';

  UPDATE public.rtc_apuracao
     SET webhook_payload = p_payload,
         tiquete_solicitacao = coalesce(p_payload->>'tiqueteSolicitacao', tiquete_solicitacao),
         tiquete_download = v_tiquete,
         url_assinada = v_url,
         url_assinada_expira_em = nullif(p_payload->>'urlAssinadaExpiraEm','')::timestamptz,
         status = CASE
           WHEN v_url IS NOT NULL OR v_tiquete IS NOT NULL THEN 'tiquete_recebido'
           ELSE 'erro'
         END,
         erro = CASE
           WHEN v_url IS NULL AND v_tiquete IS NULL
             THEN coalesce(
                    nullif(p_payload->>'mensagemErro',''),
                    'retorno sem url assinada nem tiquete (corpo bruto em webhook_payload)')
           ELSE NULL
         END,
         webhook_recebido_em = now(),
         webhook_ref = NULL
   WHERE id = v.id;

  UPDATE public.rtc_webhook_recebido
     SET aceito = true, apuracao_id = v.id
   WHERE id = v_log;

  PERFORM public.log_audit(
    v.tenant_id, 'apuracao.tiquete', 'rtc_apuracao', v.id::text, NULL,
    jsonb_build_object('recebido_em', now(),
                       'formato', CASE WHEN v_url IS NOT NULL THEN 'v2'
                                       WHEN v_tiquete IS NOT NULL THEN 'v1'
                                       ELSE 'erro' END)
  );

  RETURN jsonb_build_object('ok', true, 'id', v.id);
END;
$function$;

revoke all on function public.rtc_apuracao_receber_tiquete(text, jsonb) from public, anon, authenticated;
grant execute on function public.rtc_apuracao_receber_tiquete(text, jsonb) to service_role;

create or replace function public.rtc_apuracao_expirar_pendentes()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare n int;
begin
  update rtc_apuracao
     set status = 'erro', erro = 'A Receita não retornou o tíquete em 24 horas', webhook_ref = null
   where status = 'solicitada' and solicitado_em < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.rtc_apuracao_expirar_pendentes() from public, anon, authenticated;
grant execute on function public.rtc_apuracao_expirar_pendentes() to service_role;
