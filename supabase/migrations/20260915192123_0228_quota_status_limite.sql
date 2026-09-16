-- 0228_quota_status_limite.sql
-- O "2" da Receita estava gravado direto em seis lugares de rtc_quota_status
-- (limite, restantes, pode_manual e as tres mensagens). A v1 abre 2 consultas
-- por dia; a v2 (out/2026) abre 4. Sem isto, no dia em que a v2 virar padrao a
-- tela bloquearia a 3a e a 4a aberturas dizendo que a cota acabou.
-- Mesmo espirito da 0226: sem parametro, nada muda.
-- Esta funcao e chamada pelo FRONT (usuario logado) e tem in_scope como
-- primeira linha; `authenticated` PRECISA continuar com execute. O drop antes
-- do create evita sobrecarga ambigua, e leva os grants junto — por isso sao
-- reemitidos depois.
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

-- Preocupacao registrada, nao resolvida: rtc_api_quota tem UM contador
-- (solicitacoes) por CNPJ e dia, mas v1 e v2 sao endpoints diferentes na
-- Receita, com limites diferentes (2 e 4) e provavelmente contadores separados
-- do lado deles. Enquanto as duas convivem, nosso numero mistura as duas
-- coisas. Resolver depende de saber como a Receita conta de fato.
