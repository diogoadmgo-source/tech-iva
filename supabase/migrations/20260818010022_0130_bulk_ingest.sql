-- Migration 20260818010022 (0130_bulk_ingest) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- INGESTÃO EM LOTE — o terceiro worker que ainda faria round-trip por linha
-- ============================================================================
-- O teste de carga corrigiu compute_taxes e project_cash, mas o ingest_dfe
-- continuava fazendo um upsert por nota + um por item + um por recebível.
-- Para 100 mil notas isso é ~500 mil chamadas HTTP: horas, e com risco de o job
-- morrer no meio deixando o cliente com metade da operação carregada.
--
-- Aqui a nota inteira (cabeçalho + itens + parcelas) chega em UM lote JSON e o
-- banco resolve tudo em três instruções, numa transação. Idempotente pela chave
-- de acesso: reprocessar o mesmo lote não duplica nada.

create or replace function ingest_invoices_batch(p_tenant uuid, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_notas int := 0; v_itens int := 0; v_parcelas int := 0;
        v_partes int := 0; v_inconsistentes int := 0;
begin
  -- 1. contrapartes que ainda não existem (o CNPJ da nota pode ser cliente novo)
  with novas as (
    select distinct
      regexp_replace(e->>'counterparty_cnpj','\D','','g') cnpj,
      e->>'counterparty_name' nome,
      (case when e->>'direction' = 'out' then 'customer' else 'supplier' end)::party_role papel
    from jsonb_array_elements(p_batch) e
    where coalesce(e->>'counterparty_cnpj','') <> ''
  )
  insert into counterparties (tenant_id, cnpj, name, role)
  select p_tenant, n.cnpj, n.nome, n.papel from novas n
  on conflict (tenant_id, cnpj) do update
    set name = coalesce(nullif(btrim(counterparties.name),''), excluded.name);
  get diagnostics v_partes = row_count;

  -- 2. notas (idempotente pela chave de acesso)
  with dados as (
    select e->>'access_key' access_key,
           (e->>'direction')::invoice_direction direction,
           coalesce(e->>'model','55') model,
           e->>'number' numero, e->>'series' serie,
           (e->>'issued_at')::date issued_at,
           regexp_replace(coalesce(e->>'counterparty_cnpj',''),'\D','','g') cnpj,
           (e->>'total_cents')::bigint total_cents,
           e->>'raw_xml_path' raw_xml_path,
           coalesce(e->'inconsistencies','[]'::jsonb) inconsistencias,
           e->'items' itens, e->'installments' parcelas
    from jsonb_array_elements(p_batch) e
    where coalesce(e->>'access_key','') <> ''
  )
  insert into invoices (tenant_id, direction, model, access_key, number, series, issued_at,
                        counterparty_id, total_cents, raw_xml_path, inconsistencies, status)
  select p_tenant, d.direction, d.model, d.access_key, d.numero, d.serie, d.issued_at,
         c.id, d.total_cents, d.raw_xml_path, d.inconsistencias, 'authorized'
  from dados d
  left join counterparties c on c.tenant_id = p_tenant and regexp_replace(c.cnpj,'\D','','g') = d.cnpj
  on conflict (access_key) do update
    set total_cents = excluded.total_cents,
        inconsistencies = excluded.inconsistencies,
        raw_xml_path = coalesce(excluded.raw_xml_path, invoices.raw_xml_path),
        counterparty_id = coalesce(excluded.counterparty_id, invoices.counterparty_id);
  get diagnostics v_notas = row_count;

  -- 3. itens
  with linhas as (
    select i.id invoice_id,
           (it->>'line')::int line, it->>'ncm' ncm, it->>'nbs' nbs,
           it->>'cst' cst, it->>'cclasstrib' cclasstrib, it->>'description' descricao,
           (it->>'qty')::numeric qty, it->>'unit' unit,
           (it->>'unit_price_cents')::bigint unit_price, (it->>'base_cents')::bigint base
    from jsonb_array_elements(p_batch) e
    join invoices i on i.access_key = e->>'access_key' and i.tenant_id = p_tenant
    cross join lateral jsonb_array_elements(coalesce(e->'items','[]'::jsonb)) it
  )
  insert into invoice_items (tenant_id, invoice_id, line, ncm, cst, cclasstrib, description,
                             qty, unit, unit_price_cents, base_cents)
  select p_tenant, l.invoice_id, l.line, coalesce(l.ncm, l.nbs), l.cst, l.cclasstrib,
         l.descricao, l.qty, l.unit, l.unit_price, l.base
  from linhas l
  on conflict (invoice_id, line) do update
    set ncm = excluded.ncm, cst = excluded.cst, cclasstrib = excluded.cclasstrib,
        description = excluded.description, qty = excluded.qty,
        unit_price_cents = excluded.unit_price_cents, base_cents = excluded.base_cents;
  get diagnostics v_itens = row_count;

  -- 4. parcelas (só de saídas: é o que vira recebível)
  with parcelas as (
    select i.id invoice_id, i.issued_at,
           row_number() over (partition by i.id order by (p->>'due_date')) parcela,
           (p->>'due_date')::date vencimento, (p->>'amount_cents')::bigint valor
    from jsonb_array_elements(p_batch) e
    join invoices i on i.access_key = e->>'access_key' and i.tenant_id = p_tenant
    cross join lateral jsonb_array_elements(coalesce(e->'installments','[]'::jsonb)) p
    where (e->>'direction') = 'out'
  )
  insert into receivables (tenant_id, invoice_id, installment, due_date, amount_cents, source, confidence)
  select p_tenant, pa.invoice_id, pa.parcela, pa.vencimento, pa.valor, 'invoice', 0.8
  from parcelas pa
  where not exists (select 1 from receivables r
                    where r.invoice_id = pa.invoice_id and r.installment = pa.parcela);
  get diagnostics v_parcelas = row_count;

  -- 5. alerta único por lote, em vez de um por nota (senão o sino vira spam)
  select count(*) into v_inconsistentes
  from jsonb_array_elements(p_batch) e
  where jsonb_array_length(coalesce(e->'inconsistencies','[]'::jsonb)) > 0;

  if v_inconsistentes > 0 then
    insert into alerts (tenant_id, kind, severity, title, payload)
    values (p_tenant, 'inconsistent_item', 'warning',
            v_inconsistentes||' documentos com inconsistência de classificação neste lote',
            jsonb_build_object('documentos', v_inconsistentes, 'lote_em', now()));
  end if;

  return jsonb_build_object('notas', v_notas, 'itens', v_itens, 'parcelas', v_parcelas,
                            'contrapartes_novas', v_partes, 'com_inconsistencia', v_inconsistentes);
end $$;
revoke execute on function ingest_invoices_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function ingest_invoices_batch(uuid, jsonb) to service_role;

-- Retomada: se o job morrer no meio de uma carga de 100 mil notas, precisamos
-- saber onde parou em vez de recomeçar do zero.
create or replace function ingest_checkpoint(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'ultima_nota', max(issued_at),
    'total', count(*),
    'ultima_ingestao', max(ingested_at),
    'sem_calculo', count(*) filter (where rule_version_id is null)
  ) into v from invoices where tenant_id = p_tenant;
  return v;
end $$;
revoke execute on function ingest_checkpoint(uuid) from public, anon, authenticated;
grant execute on function ingest_checkpoint(uuid) to service_role;
