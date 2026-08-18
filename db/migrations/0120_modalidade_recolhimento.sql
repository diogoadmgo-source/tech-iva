-- 0120_modalidade_recolhimento.sql — ESPELHO da migration aplicada no banco.
--
-- CORREÇÃO DE PREMISSA (CGIBS, 12/08/2026): o split payment NÃO começa em janeiro
-- de 2027 — as instituições financeiras pediram prazo, e quando vier será gradual,
-- na primeira etapa OPCIONAL e restrito a B2B. Para 2027 existe também o RAD
-- (Recolhimento pelo Adquirente), igualmente OPCIONAL. O PADRÃO de 2027 é a
-- APURAÇÃO MENSAL: o imposto sai no vencimento da guia, dia 20 do mês seguinte.
--
-- Por isso a modalidade deixa de ser premissa implícita do projetor e passa a ser
-- premissa EXPLÍCITA e COMPARÁVEL, escolhida pela empresa e auditada.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'modalidade_recolhimento') then
    create type modalidade_recolhimento as enum ('apuracao','rad','split');
  end if;
end $$;

-- Modalidade fica em tenants.settings; o padrão é 'apuracao'.
create or replace function public.tenant_modalidade(p_tenant uuid)
returns modalidade_recolhimento
language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select coalesce((select (t.settings->>'modalidade_recolhimento')::modalidade_recolhimento
                   from tenants t where t.id = p_tenant), 'apuracao'::modalidade_recolhimento);
$function$;

create or replace function public.set_tenant_modalidade(p_tenant uuid, p_modalidade modalidade_recolhimento)
returns void
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
begin
  if not has_role(p_tenant, array['platform_admin','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;
  update tenants set settings = coalesce(settings,'{}'::jsonb) ||
    jsonb_build_object('modalidade_recolhimento', p_modalidade::text) where id = p_tenant;
  perform log_audit(p_tenant,'tenant.modalidade','tenant',p_tenant::text,null,
                    jsonb_build_object('modalidade',p_modalidade));
end $function$;

-- Apuração: dia 20 do mês seguinte à emissão. RAD e split: na data do recebimento.
create or replace function public.data_saida_imposto(p_modalidade modalidade_recolhimento, p_emissao date, p_recebimento date)
returns date
language sql immutable set search_path to 'public', 'extensions'
as $function$
  select case p_modalidade
    when 'apuracao' then (date_trunc('month', p_emissao) + interval '1 month' + interval '19 days')::date
    else coalesce(p_recebimento, p_emissao)
  end;
$function$;

grant execute on function public.tenant_modalidade(uuid) to authenticated;
grant execute on function public.set_tenant_modalidade(uuid, modalidade_recolhimento) to authenticated;
grant execute on function public.data_saida_imposto(modalidade_recolhimento, date, date) to authenticated;
