-- 0228_quota_status_limite.sql — ESPELHO da migration a aplicar no banco.
--
-- Corpo de `rtc_quota_status` abaixo levantado do banco em 15/09/2026 (ver
-- .superpowers/sdd/2026-09-15-api-v2-apuracao-cbs/quota-status-contexto.md).
-- Só o parametro novo, o texto e o retorno mudam; o resto e fiel ao que roda
-- hoje.

-- ───────────────── cota exibida na tela: o limite deixa de ser fixo ────────
-- Mesmo defeito que a 0226 corrigiu em rtc_quota_take/rtc_apuracao_solicitar:
-- o "2" da Receita estava gravado direto em seis lugares desta funcao
-- (limite, restantes, pode_manual e as tres mensagens). A v1 abre 2 consultas
-- por dia; a v2 (out/2026) abre 4. Sem isto, no dia em que a v2 virar padrao
-- a tela bloquearia a 3a e a 4a aberturas do usuario dizendo que a cota
-- acabou, quando ainda restam duas — pior que mostrar um numero errado, e uma
-- trava que impede o trabalho.
--
-- Mesmo espirito da 0226: sem parametro, nada muda. Isso mantem a v1 intacta
-- enquanto ela for a unica com chamador.
--
-- Assinatura: esta funcao e chamada pelo FRONT (usuario logado), por isso tem
-- in_scope(p_tenant) como primeira linha — diferente das outras funcoes de
-- cota, que sao service_role apenas. `authenticated` precisa continuar com
-- execute. Acrescentar parametro com default cria sobrecarga e a chamada com
-- 1 argumento fica ambigua (mesmo motivo da 0226); por isso o drop antes do
-- create, e os grants sao reemitidos depois porque o drop os leva junto.
drop function if exists public.rtc_quota_status(uuid);

create or replace function public.rtc_quota_status(p_tenant uuid, p_limite int default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_cnpj text; v_c8 text; v_usadas int; v_downloads int; v_limite int;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;

  -- Limite de quem chama (a v2 manda 4); sem ele, o de hoje (2) — mesma regra
  -- da 0226 em rtc_quota_take.
  v_limite := coalesce(p_limite, 2);
  if v_limite < 1 then raise exception 'limite de cota invalido: %', p_limite; end if;

  select cnpj into v_cnpj from tenants where id = p_tenant;
  v_c8 := left(regexp_replace(coalesce(v_cnpj,''),'\D','','g'), 8);

  select coalesce(solicitacoes,0), coalesce(downloads,0) into v_usadas, v_downloads
    from rtc_api_quota where cnpj8=v_c8 and dia=current_date;
  v_usadas := coalesce(v_usadas,0); v_downloads := coalesce(v_downloads,0);

  return jsonb_build_object(
    'usadas', v_usadas,
    'limite', v_limite,
    'restantes', greatest(v_limite - v_usadas, 0),
    'pode_manual', v_usadas < v_limite,
    'downloads_usados', v_downloads,
    -- o numero sai interpolado: cravar "2" mentiria quando o limite e 4
    -- (mesmo cuidado da mensagem de rtc_quota_take na 0226)
    'mensagem', case
      when v_usadas = 0 then 'A Receita permite '||v_limite||' consultas por dia. Nenhuma usada hoje.'
      when v_usadas < v_limite - 1 then 'A Receita permite '||v_limite||' consultas por dia. Você já usou '||v_usadas||'.'
      when v_usadas = v_limite - 1 then 'A Receita permite '||v_limite||' consultas por dia. Você está na '||v_limite||'ª e última de hoje.'
      else 'As '||v_limite||' consultas diárias permitidas pela Receita já foram usadas hoje. A cota reinicia amanhã.'
    end,
    'reinicia_em', (current_date + 1)::text);
end $function$;

revoke all on function public.rtc_quota_status(uuid, int) from public, anon;
grant execute on function public.rtc_quota_status(uuid, int) to authenticated, service_role;

-- ───────────── preocupacao para registrar, nao para resolver agora ─────────
-- `rtc_api_quota` tem UM contador so (`solicitacoes`) por CNPJ e dia. Mas v1 e
-- v2 sao endpoints diferentes na Receita, com limites diferentes (2 e 4) e
-- provavelmente contadores separados do lado deles. Enquanto as duas
-- convivem, nosso contador unico mistura as duas coisas: uma consulta feita
-- pela v1 conta contra o limite que a tela mostraria para a v2, e vice-versa.
-- Isso nao foi resolvido aqui porque depende de saber como a Receita conta de
-- fato do lado dela, o que so se confirma na pratica quando a v2 estiver
-- em producao. Quem for ligar o chamador da v2 a rtc_quota_status (hoje
-- ninguem passa p_limite — ver src/lib/rtc.ts e src/lib/nav-prefetch.ts, que
-- chamam so com p_tenant) precisa decidir tambem se o contador continua unico
-- ou se passa a ser por versao.

-- Pos-voo:
-- select pg_get_function_arguments(oid) from pg_proc
--  where proname='rtc_quota_status' and pronamespace='public'::regnamespace; -- confirma "p_limite integer DEFAULT NULL::integer"
-- select rtc_quota_status('<tenant-id>'::uuid); -- deve continuar devolvendo limite=2 sem parametro
-- select has_function_privilege('authenticated', 'public.rtc_quota_status(uuid,int)', 'execute'); -- true
