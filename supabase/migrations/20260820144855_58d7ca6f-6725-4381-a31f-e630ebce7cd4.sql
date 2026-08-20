-- 0216 — Estorno da cota quando a consulta nao chegou a Receita.
create or replace function public.rtc_quota_estornar(p_cnpj text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8);
        v_novo int;
begin
  if p_kind not in ('solicitacao','download') then
    raise exception 'tipo de cota invalido: %', p_kind;
  end if;

  if p_kind = 'solicitacao' then
    update rtc_api_quota set solicitacoes = greatest(solicitacoes - 1, 0)
      where cnpj8 = v_c8 and dia = current_date
      returning solicitacoes into v_novo;
  else
    update rtc_api_quota set downloads = greatest(downloads - 1, 0)
      where cnpj8 = v_c8 and dia = current_date
      returning downloads into v_novo;
  end if;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'usado', coalesce(v_novo, 0));
end $$;

revoke all on function public.rtc_quota_estornar(text, text) from public, anon, authenticated;
grant execute on function public.rtc_quota_estornar(text, text) to service_role;

-- Devolve as tentativas de hoje que falharam antes de chegar a Receita.
update public.rtc_api_quota q
   set solicitacoes = greatest(
        q.solicitacoes - (
          select count(*) from public.rtc_apuracao a
            join public.tenants t on t.id = a.tenant_id
           where left(regexp_replace(coalesce(t.cnpj,''),'\D','','g'), 8) = q.cnpj8
             and a.status = 'erro'
             and a.solicitado_em::date = current_date
        )::int, 0)
 where q.dia = current_date;