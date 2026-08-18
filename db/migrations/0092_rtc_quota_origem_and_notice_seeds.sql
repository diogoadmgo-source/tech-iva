-- 0092 — Cota da Receita: 1 consulta automática por dia, 1 reservada ao usuário.
-- ESPELHO: já aplicada no banco pelo Diogo. Não reaplicar.

create or replace function public.rtc_quota_take(p_cnpj text, p_kind text, p_origem text default 'manual')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8);
        v_limite_receita int := case p_kind when 'solicitacao' then 2 when 'download' then 8 else 0 end;
        v_limite_efetivo int;
        v_atual int;
begin
  if v_limite_receita = 0 then raise exception 'tipo de cota invalido: %', p_kind; end if;
  if p_origem not in ('manual','automatico') then raise exception 'origem invalida: %', p_origem; end if;

  -- a rotina automática nunca gasta a última solicitação do dia
  v_limite_efetivo := case
    when p_kind = 'solicitacao' and p_origem = 'automatico' then v_limite_receita - 1
    else v_limite_receita end;

  insert into rtc_api_quota (cnpj8, dia) values (v_c8, current_date)
  on conflict (cnpj8, dia) do nothing;

  select case when p_kind='solicitacao' then solicitacoes else downloads end
    into v_atual from rtc_api_quota where cnpj8=v_c8 and dia=current_date for update;

  if v_atual >= v_limite_efetivo then
    return jsonb_build_object(
      'permitido', false, 'usado', v_atual, 'limite', v_limite_receita,
      'limite_efetivo', v_limite_efetivo, 'origem', p_origem,
      'motivo', case
        when p_origem = 'automatico'
          then 'A consulta automática do dia já foi feita. A consulta restante fica reservada para você pedir quando quiser.'
        else 'A Receita Federal limita '||v_limite_receita||' consultas por dia por CNPJ, e as duas já foram usadas hoje. Tente novamente amanhã.'
      end);
  end if;

  if p_kind='solicitacao' then
    update rtc_api_quota set solicitacoes = solicitacoes + 1 where cnpj8=v_c8 and dia=current_date;
  else
    update rtc_api_quota set downloads = downloads + 1 where cnpj8=v_c8 and dia=current_date;
  end if;

  return jsonb_build_object('permitido', true, 'usado', v_atual + 1,
                            'limite', v_limite_receita, 'restantes', v_limite_receita - (v_atual + 1),
                            'origem', p_origem);
end $$;

create or replace function public.rtc_quota_status(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_cnpj text; v_c8 text; v_usadas int; v_downloads int;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select cnpj into v_cnpj from tenants where id = p_tenant;
  v_c8 := left(regexp_replace(coalesce(v_cnpj,''),'\D','','g'), 8);

  select coalesce(solicitacoes,0), coalesce(downloads,0) into v_usadas, v_downloads
    from rtc_api_quota where cnpj8=v_c8 and dia=current_date;
  v_usadas := coalesce(v_usadas,0); v_downloads := coalesce(v_downloads,0);

  return jsonb_build_object(
    'usadas', v_usadas,
    'limite', 2,
    'restantes', greatest(2 - v_usadas, 0),
    'pode_manual', v_usadas < 2,
    'downloads_usados', v_downloads,
    'mensagem', case
      when v_usadas = 0 then 'A Receita permite 2 consultas por dia. Nenhuma usada hoje.'
      when v_usadas = 1 then 'A Receita permite 2 consultas por dia. Você está na 2ª e última de hoje.'
      else 'As 2 consultas diárias permitidas pela Receita já foram usadas hoje. A cota reinicia amanhã.'
    end,
    'reinicia_em', (current_date + 1)::text);
end $$;

-- Textos dos avisos (editáveis pela plataforma, sem deploy) — ver db/seeds.
