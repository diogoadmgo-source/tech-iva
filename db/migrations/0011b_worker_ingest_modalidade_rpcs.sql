-- 0011b_worker_ingest_modalidade_rpcs.sql
-- ESPELHO de funções que existiam no banco sem arquivo correspondente em db/migrations.
-- Sem elas, um ambiente reconstruído do zero sobe sem worker (claim_job/report_job),
-- sem ingestão (ingest_invoices_batch), sem partição de tax_cash_events e sem
-- modalidade de recolhimento — tudo falhando só em runtime. Extraído de pg_get_functiondef.
-- Corpos plpgsql não são resolvidos na criação, então referências a objetos criados
-- em migrations posteriores (feature_enabled, mv_cash_timeline) são seguras aqui.

-- ============================== fila de trabalho (worker) ==============================

create or replace function public.claim_job(p_kinds text[], p_worker text, p_lease_seconds integer default 300)
returns setof jobs
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v jobs;
begin
  select j.* into v from jobs j
   where j.kind = any(p_kinds)
     and (
       (j.status = 'queued' and coalesce(j.next_attempt_at, j.queued_at) <= now())
       or (j.status = 'running' and j.lease_until < now())
     )
     and not exists (
       select 1 from jobs o where o.tenant_id = j.tenant_id and o.kind = j.kind
         and o.status = 'running' and o.lease_until >= now() and o.id <> j.id
     )
   order by j.queued_at
   for update skip locked
   limit 1;

  if v.id is null then return; end if;   -- conjunto vazio: não há trabalho

  update jobs set status='running', started_at=coalesce(started_at, now()),
                  worker=p_worker, attempts=attempts+1,
                  lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = v.id returning * into v;

  return next v;
end $function$;

create or replace function public.report_job(p_job uuid, p_status job_status, p_progress numeric default null::numeric,
                                             p_message text default null::text, p_result jsonb default null::jsonb,
                                             p_error text default null::text, p_lease_seconds integer default 300)
returns void
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v jobs; v_backoff interval;
begin
  select * into v from jobs where id = p_job;
  if v.id is null then raise exception 'job not found'; end if;

  if p_status = 'failed' and v.attempts < 5 then
    -- backoff: 30s, 2min, 10min, 1h, 6h
    v_backoff := (array['30 seconds','2 minutes','10 minutes','1 hour','6 hours'])[least(v.attempts,5)]::interval;
    update jobs set status='queued', error=p_error, message=p_message,
                    next_attempt_at = now() + v_backoff, lease_until=null
     where id=p_job;
    return;
  end if;

  update jobs set status=p_status,
                  progress=coalesce(p_progress, progress),
                  message=coalesce(p_message, message),
                  result=coalesce(p_result, result),
                  error=p_error,
                  lease_until = case when p_status='running'
                                     then now() + make_interval(secs => p_lease_seconds) else null end,
                  finished_at = case when p_status in ('done','failed','canceled') then now() else null end
   where id=p_job;

  if p_status='failed' then
    insert into alerts (tenant_id,kind,severity,title,payload)
    values (v.tenant_id,'ingest_failed','warning','Falha em '||v.kind||' após '||v.attempts||' tentativas',
            jsonb_build_object('job_id',p_job,'error',p_error));
  end if;
end $function$;

-- worker usa service_role; nunca expor à sessão do navegador
revoke execute on function public.claim_job(text[], text, integer) from anon, authenticated;
revoke execute on function public.report_job(uuid, job_status, numeric, text, jsonb, text, integer) from anon, authenticated;
grant execute on function public.claim_job(text[], text, integer) to service_role;
grant execute on function public.report_job(uuid, job_status, numeric, text, jsonb, text, integer) to service_role;

-- ============================== feature flags ==============================

create or replace function public.require_feature(p_tenant uuid, p_feature text)
returns void
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
begin
  if not feature_enabled(p_tenant, p_feature) then
    raise exception 'feature disabled: %', p_feature;
  end if;
end $function$;

-- ============================== ingestão de documentos ==============================

create or replace function public.ensure_tce_partition(p_date date)
returns void
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_start date := date_trunc('month', p_date)::date;
        v_end   date := (date_trunc('month', p_date) + interval '1 month')::date;
        v_name  text := 'tax_cash_events_' || to_char(v_start,'YYYYMM');
begin
  if not exists (select 1 from pg_class where relname = v_name) then
    execute format('create table %I partition of tax_cash_events for values from (%L) to (%L)', v_name, v_start, v_end);
    execute format('alter table %I enable row level security', v_name);
  end if;
end $function$;

create or replace function public.ingest_checkpoint(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'ultima_nota', max(issued_at),
    'total', count(*),
    'ultima_ingestao', max(ingested_at),
    'sem_calculo', count(*) filter (where rule_version_id is null)
  ) into v from invoices where tenant_id = p_tenant;
  return v;
end $function$;

create or replace function public.refresh_cash_timeline()
returns void
language sql security definer set search_path to 'public', 'extensions'
as $function$
  refresh materialized view concurrently mv_cash_timeline;
$function$;

create or replace function public.ingest_invoices_batch(p_tenant uuid, p_batch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
end $function$;

-- ============================== modalidade de recolhimento ==============================

create or replace function public.data_saida_imposto(p_modalidade modalidade_recolhimento, p_emissao date, p_recebimento date)
returns date
language sql immutable set search_path to 'public', 'extensions'
as $function$
  select case p_modalidade
    when 'apuracao' then (date_trunc('month', p_emissao) + interval '1 month' + interval '19 days')::date
    else coalesce(p_recebimento, p_emissao)
  end;
$function$;

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

create or replace function public.comparar_modalidades(p_tenant uuid, p_horizon_days integer default 120)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare v_hoje date := current_date; v_fim date; v_weekly bigint; v_res jsonb := '[]'::jsonb;
        m modalidade_recolhimento; v_g30 bigint; v_g60 bigint; v_g90 bigint;
        v_sem date; v_saldo bigint;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  v_fim := v_hoje + p_horizon_days;

  select coalesce(sum(ibs_cents + cbs_cents),0) / 13 into v_weekly
  from invoices where tenant_id = p_tenant and direction='out' and issued_at >= v_hoje - 90;

  foreach m in array array['apuracao','rad','split']::modalidade_recolhimento[] loop
    with fluxo as (
      select data_saida_imposto(m, i.issued_at, coalesce(r.expected_date, r.due_date)) d,
             -(i.ibs_cents + i.cbs_cents) v
      from receivables r join invoices i on i.id=r.invoice_id
      where r.tenant_id=p_tenant and r.paid_at is null and (i.ibs_cents+i.cbs_cents)>0
      union all
      select case when m='apuracao'
                  then (date_trunc('month', g) + interval '1 month' + interval '19 days')::date
                  else g::date end,
             case when m='apuracao' then -(v_weekly*4.33)::bigint else -v_weekly end
      from generate_series(
             case when m='apuracao' then date_trunc('month', v_hoje)::date
                  else date_trunc('week', v_hoje)::date + 7 end,
             v_fim,
             case when m='apuracao' then interval '1 month' else interval '7 days' end) g
      where v_weekly > 0
      union all
      select (issued_at + 150)::date, credit_cents
      from invoices where tenant_id=p_tenant and direction='in' and credit_cents>0
    ),
    janela as (select d, v from fluxo where d between v_hoje and v_fim),
    totais as (
      select coalesce(sum(v) filter (where d <= v_hoje+30),0) g30,
             coalesce(sum(v) filter (where d <= v_hoje+60),0) g60,
             coalesce(sum(v) filter (where d <= v_hoje+90),0) g90
      from janela),
    pior as (
      select date_trunc('week', d)::date sem, sum(v) s
      from janela group by 1 order by 2 asc limit 1)
    select t.g30, t.g60, t.g90, p.sem, p.s
      into v_g30, v_g60, v_g90, v_sem, v_saldo
    from totais t left join pior p on true;

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'modalidade', m,
      'rotulo', case m when 'apuracao' then 'Apuração mensal (padrão em 2027)'
                       when 'rad' then 'Recolhimento pelo Adquirente (opcional)'
                       else 'Split Payment (sem data definida)' end,
      'gap_30_cents', coalesce(v_g30,0), 'gap_60_cents', coalesce(v_g60,0),
      'gap_90_cents', coalesce(v_g90,0),
      'pior_semana', case when v_sem is null then null
                          else jsonb_build_object('semana', to_char(v_sem,'YYYY-MM-DD'),
                                                  'saldo_cents', v_saldo) end));
  end loop;

  return jsonb_build_object(
    'atual', tenant_modalidade(p_tenant),
    'horizonte_dias', p_horizon_days,
    'cenarios', v_res,
    'observacao', 'O split payment não começa em janeiro de 2027 (CGIBS, 12/08/2026). '||
                  'Quando vier, será gradual e opcional na primeira etapa, restrito a B2B. '||
                  'O RAD é alternativa opcional para 2027. A modalidade muda QUANDO o imposto '||
                  'deixa o seu caixa, não QUANTO você paga.');
end $function$;

grant execute on function public.require_feature(uuid, text) to authenticated;
grant execute on function public.ingest_checkpoint(uuid) to authenticated;
grant execute on function public.tenant_modalidade(uuid) to authenticated;
grant execute on function public.set_tenant_modalidade(uuid, modalidade_recolhimento) to authenticated;
grant execute on function public.comparar_modalidades(uuid, integer) to authenticated;
grant execute on function public.data_saida_imposto(modalidade_recolhimento, date, date) to authenticated;
revoke execute on function public.ingest_invoices_batch(uuid, jsonb) from anon, authenticated;
revoke execute on function public.ensure_tce_partition(date) from anon, authenticated;
revoke execute on function public.refresh_cash_timeline() from anon, authenticated;
grant execute on function public.ingest_invoices_batch(uuid, jsonb) to service_role;
grant execute on function public.ensure_tce_partition(date) to service_role;
grant execute on function public.refresh_cash_timeline() to service_role;
