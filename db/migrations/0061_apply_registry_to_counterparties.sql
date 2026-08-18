-- 0061_apply_registry_to_counterparties.sql
-- ESPELHO da migration já aplicada no banco pela equipe (não reaplicar em produção).
-- Liga o cache global de CNPJ à carteira de cada tenant.

-- CNPJs da carteira que faltam no cache ou já passaram do TTL.
create or replace function public.counterparties_missing_registry(
  p_tenant uuid, p_ttl_days integer default 30
) returns table(cnpj text)
language plpgsql stable security definer
set search_path to 'public','extensions' as $$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select distinct regexp_replace(c.cnpj, '\D', '', 'g')
  from counterparties c
  left join cnpj_registry r on r.cnpj = regexp_replace(c.cnpj, '\D', '', 'g')
  where c.tenant_id = p_tenant
    and length(regexp_replace(c.cnpj, '\D', '', 'g')) = 14
    and (r.cnpj is null or r.fetched_at < now() - make_interval(days => p_ttl_days));
end $$;

-- Aplica o cache na carteira: nome, regime e crédito transferido.
-- NUNCA sobrescreve regime_source = 'manual'. Gera alerta quando o regime muda.
create or replace function public.apply_registry_to_counterparties(p_tenant uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public','extensions' as $$
declare v_updated int := 0; v_changed int := 0; r record; v_new regime_kind;
begin
  if not has_role(p_tenant, array['platform_admin','platform_ops','channel_admin','owner','finance']::member_role[]) then
    raise exception 'forbidden';
  end if;

  for r in
    select c.id, c.cnpj, c.name, c.regime, reg.razao_social, reg.nome_fantasia,
           reg.simples_optante, reg.mei_optante, reg.natureza_juridica
    from counterparties c
    join cnpj_registry reg on reg.cnpj = regexp_replace(c.cnpj, '\D', '', 'g')
    where c.tenant_id = p_tenant
      and coalesce(c.regime_source,'') <> 'manual'
  loop
    v_new := regime_from_registry(r.simples_optante, r.mei_optante, r.natureza_juridica);

    if v_new is distinct from r.regime and r.regime is distinct from 'desconhecido' then
      v_changed := v_changed + 1;
      insert into alerts (tenant_id, kind, severity, title, payload)
      values (p_tenant, 'regime_changed', 'warning',
              'Regime alterado: ' || coalesce(r.name, r.cnpj),
              jsonb_build_object('counterparty_id', r.id, 'from', r.regime, 'to', v_new));
    end if;

    update counterparties set
      name = coalesce(nullif(btrim(name),''), r.nome_fantasia, r.razao_social),
      regime = v_new,
      regime_source = 'registry',
      regime_checked_at = now(),
      credit_transfer_pct = credit_pct_from_regime(v_new)
    where id = r.id;
    v_updated := v_updated + 1;
  end loop;

  perform log_audit(p_tenant, 'chain.registry_applied', 'counterparty', null, null,
                    jsonb_build_object('updated', v_updated, 'regime_changed', v_changed));
  return jsonb_build_object('updated', v_updated, 'regime_changed', v_changed);
end $$;

revoke all on function public.counterparties_missing_registry(uuid, integer) from public, anon;
revoke all on function public.apply_registry_to_counterparties(uuid) from public, anon;
grant execute on function public.counterparties_missing_registry(uuid, integer) to authenticated;
grant execute on function public.apply_registry_to_counterparties(uuid) to authenticated;
