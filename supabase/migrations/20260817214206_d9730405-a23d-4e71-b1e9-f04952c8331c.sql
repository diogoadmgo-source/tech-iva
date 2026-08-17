-- ============================================================ 3.9 painel da plataforma
create or replace function public.is_platform_ops()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from memberships m join tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid() and t.kind = 'platform'
      and m.role in ('platform_admin','platform_ops')
  )
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from memberships m join tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid() and t.kind = 'platform' and m.role = 'platform_admin'
  )
$$;

-- ---------------------------------------------------------------- versões de regra
create or replace function public.rule_versions_list()
returns setof jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not is_platform_ops() then raise exception 'forbidden'; end if;
  return query
    select jsonb_build_object(
      'id', rv.id, 'calc_version', rv.calc_version, 'cclasstrib_version', rv.cclasstrib_version,
      'valid_from', rv.valid_from, 'notes', rv.notes, 'is_current', rv.is_current,
      'published_at', rv.published_at, 'published_by', rv.published_by,
      'published_by_name', p.full_name)
    from rule_versions rv
    left join profiles p on p.user_id = rv.published_by
    order by rv.valid_from desc, rv.published_at desc nulls last;
end $$;

create or replace function public.create_rule_version(
  p_calc_version text, p_cclasstrib_version text, p_valid_from date, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_platform uuid;
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  if coalesce(nullif(trim(p_calc_version),''),'') = '' then raise exception 'calc_version required'; end if;
  if coalesce(nullif(trim(p_cclasstrib_version),''),'') = '' then raise exception 'cclasstrib_version required'; end if;
  if p_valid_from is null then raise exception 'valid_from required'; end if;

  insert into rule_versions (calc_version, cclasstrib_version, valid_from, notes, is_current)
  values (trim(p_calc_version), trim(p_cclasstrib_version), p_valid_from, nullif(trim(p_notes),''), false)
  returning id into v_id;

  select id into v_platform from tenants where kind = 'platform' order by created_at limit 1;
  perform log_audit(v_platform, 'rule.create', 'rule_version', v_id::text, null,
                    jsonb_build_object('calc_version', trim(p_calc_version),
                                       'cclasstrib_version', trim(p_cclasstrib_version),
                                       'valid_from', p_valid_from));
  return v_id;
end $$;

-- dry_run = true  -> devolve { dry_run, impact_preview }  (nada é alterado)
-- dry_run = false -> exige aal2, marca is_current, enfileira reprocess_rules, audita 'rule.publish'
create or replace function public.publish_rule_version(p_id uuid, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  rv record; cur record; v_rate numeric; v_cur_rate numeric; v_sample jsonb;
  v_tenants int; v_total_before bigint; v_total_after bigint; v_batch uuid; v_platform uuid;
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  select * into rv from rule_versions where id = p_id;
  if rv.id is null then raise exception 'rule version not found'; end if;

  select * into cur from rule_versions where is_current;
  v_rate := regime_iva_rate(extract(year from rv.valid_from)::int);
  v_cur_rate := regime_iva_rate(extract(year from coalesce(cur.valid_from, rv.valid_from))::int);
  select id into v_platform from tenants where kind = 'platform' order by created_at limit 1;

  -- amostra: 10 maiores tenants operacionais por imposto projetado em 90 dias
  with base as (
    select t.id, t.name, t.kind,
           coalesce(sum(e.amount_cents) filter (where e.kind = 'tax_out'), 0)::bigint as tax_out,
           coalesce(sum(e.amount_cents) filter (where e.kind = 'credit_in'), 0)::bigint as credit_in
    from tenants t
    left join tax_cash_events e
      on e.tenant_id = t.id and e.event_date between current_date and current_date + 90
    where t.kind in ('company','unit') and t.status = 'active'
    group by t.id, t.name, t.kind
  ), scored as (
    select b.*,
           case when v_cur_rate = 0 then b.tax_out
                else round(b.tax_out * (v_rate / v_cur_rate))::bigint end as tax_out_after
    from base b
  )
  select count(*)::int, coalesce(sum(tax_out),0), coalesce(sum(tax_out_after),0),
         coalesce((select jsonb_agg(jsonb_build_object(
             'tenant_id', s2.id, 'name', s2.name, 'kind', s2.kind,
             'tax_out_cents', s2.tax_out, 'projected_cents', s2.tax_out_after,
             'credit_in_cents', s2.credit_in,
             'delta_cents', s2.tax_out_after - s2.tax_out,
             'delta_pct', case when s2.tax_out = 0 then 0
                          else round(100.0 * (s2.tax_out_after - s2.tax_out) / s2.tax_out, 2) end)
             order by s2.tax_out desc)
           from (select * from scored order by tax_out desc limit 10) s2), '[]'::jsonb)
    into v_tenants, v_total_before, v_total_after, v_sample
  from scored;

  if p_dry_run then
    perform log_audit(v_platform, 'rule.dry_run', 'rule_version', p_id::text, null,
                      jsonb_build_object('tenants_affected', v_tenants,
                                         'delta_cents', v_total_after - v_total_before));
    return jsonb_build_object(
      'dry_run', true,
      'impact_preview', jsonb_build_object(
        'rule', jsonb_build_object('id', rv.id, 'calc_version', rv.calc_version,
                                   'cclasstrib_version', rv.cclasstrib_version, 'valid_from', rv.valid_from),
        'current_rule', case when cur.id is null then null else jsonb_build_object(
          'id', cur.id, 'calc_version', cur.calc_version, 'valid_from', cur.valid_from) end,
        'iva_rate_current', v_cur_rate, 'iva_rate_new', v_rate,
        'tenants_affected', v_tenants,
        'tax_out_before_cents', v_total_before,
        'tax_out_after_cents', v_total_after,
        'delta_cents', v_total_after - v_total_before,
        'delta_pct', case when v_total_before = 0 then 0
                     else round(100.0 * (v_total_after - v_total_before) / v_total_before, 2) end,
        'sample', v_sample),
      'generated_at', now());
  end if;

  -- publicação real
  perform require_aal2();
  if rv.is_current then raise exception 'rule version already current'; end if;

  update rule_versions set is_current = false where is_current;
  update rule_versions
     set is_current = true, published_at = now(), published_by = auth.uid()
   where id = p_id;

  v_batch := gen_random_uuid();
  insert into jobs (tenant_id, kind, params, requested_by)
  select t.id, 'reprocess_rules',
         jsonb_build_object('rule_version_id', p_id, 'batch_id', v_batch,
                            'calc_version', rv.calc_version,
                            'cclasstrib_version', rv.cclasstrib_version),
         auth.uid()
  from tenants t
  where t.kind in ('company','unit') and t.status = 'active';

  perform log_audit(v_platform, 'rule.publish', 'rule_version', p_id::text,
                    case when cur.id is null then null else jsonb_build_object(
                      'id', cur.id, 'calc_version', cur.calc_version, 'valid_from', cur.valid_from) end,
                    jsonb_build_object('id', rv.id, 'calc_version', rv.calc_version,
                                       'cclasstrib_version', rv.cclasstrib_version,
                                       'valid_from', rv.valid_from,
                                       'batch_id', v_batch,
                                       'jobs_enqueued', v_tenants,
                                       'impact_delta_cents', v_total_after - v_total_before));
  return jsonb_build_object('dry_run', false, 'rule_version_id', p_id,
                            'batch_id', v_batch, 'jobs_enqueued', v_tenants);
end $$;

create or replace function public.rule_reprocess_progress(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if not is_platform_ops() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'total', count(*),
    'queued', count(*) filter (where status = 'queued'),
    'running', count(*) filter (where status = 'running'),
    'done', count(*) filter (where status = 'done'),
    'failed', count(*) filter (where status = 'failed'),
    'canceled', count(*) filter (where status = 'canceled'),
    'progress_pct', case when count(*) = 0 then 0
                    else round(100.0 * count(*) filter (where status in ('done','canceled')) / count(*), 1) end)
  into v from jobs
  where kind = 'reprocess_rules' and params->>'rule_version_id' = p_id::text;
  return v;
end $$;

-- ---------------------------------------------------------------- /ops
create or replace function public.platform_ops_overview()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if not is_platform_ops() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'queues', coalesce((
      select jsonb_agg(q order by q->>'kind') from (
        select jsonb_build_object(
          'kind', j.kind,
          'queued', count(*) filter (where j.status = 'queued'),
          'running', count(*) filter (where j.status = 'running'),
          'failed', count(*) filter (where j.status = 'failed'),
          'done_24h', count(*) filter (where j.status = 'done' and j.finished_at > now() - interval '24 hours'),
          'oldest_queued_at', min(j.queued_at) filter (where j.status = 'queued')) as q
        from jobs j group by j.kind) x), '[]'::jsonb),
    'failed_jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'tenant_id', j.tenant_id, 'tenant_name', t.name, 'kind', j.kind,
        'error', j.error, 'message', j.message, 'params', j.params,
        'retry_of', j.params->>'retry_of',
        'queued_at', j.queued_at, 'finished_at', j.finished_at) order by j.finished_at desc nulls last)
      from (select * from jobs where status = 'failed' order by finished_at desc nulls last limit 50) j
      join tenants t on t.id = j.tenant_id), '[]'::jsonb),
    'integrations_health', coalesce((
      select jsonb_agg(h order by h->>'kind') from (
        select jsonb_build_object(
          'kind', i.kind,
          'total', count(*),
          'connected', count(*) filter (where i.status = 'connected'),
          'pending', count(*) filter (where i.status = 'pending'),
          'error', count(*) filter (where i.status = 'error'),
          'last_sync', max(i.last_sync),
          'last_error', (select i2.error from integrations i2
                          where i2.kind = i.kind and i2.error is not null
                          order by i2.last_sync desc nulls last limit 1)) as h
        from integrations i group by i.kind) y), '[]'::jsonb),
    'stale_ingest', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenant_id', t.id, 'name', t.name, 'cnpj', t.cnpj,
        'last_ingest', li.last_done,
        'days_since', case when li.last_done is null then null
                      else floor(extract(epoch from (now() - li.last_done)) / 86400)::int end)
        order by li.last_done nulls first)
      from tenants t
      left join lateral (
        select max(j.finished_at) as last_done from jobs j
         where j.tenant_id = t.id and j.kind = 'ingest_dfe' and j.status = 'done') li on true
      where t.kind = 'company' and t.status = 'active'
        and (li.last_done is null or li.last_done < now() - interval '7 days')), '[]'::jsonb),
    'rule_current', (select jsonb_build_object('id', rv.id, 'calc_version', rv.calc_version,
                            'cclasstrib_version', rv.cclasstrib_version, 'valid_from', rv.valid_from,
                            'published_at', rv.published_at)
                       from rule_versions rv where rv.is_current limit 1),
    'generated_at', now())
  into v;
  return v;
end $$;

create or replace function public.retry_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare j record; v_new uuid;
begin
  if not is_platform_ops() then raise exception 'forbidden'; end if;
  select * into j from jobs where id = p_job;
  if j.id is null then raise exception 'job not found'; end if;
  if j.status <> 'failed' then raise exception 'only failed jobs can be retried'; end if;

  insert into jobs (tenant_id, kind, params, requested_by)
  values (j.tenant_id, j.kind,
          coalesce(j.params, '{}'::jsonb) || jsonb_build_object('retry_of', j.id), auth.uid())
  returning id into v_new;

  perform log_audit(j.tenant_id, 'job.retry', 'job', v_new::text,
                    jsonb_build_object('job_id', j.id, 'error', j.error),
                    jsonb_build_object('job_id', v_new, 'kind', j.kind, 'retry_of', j.id));
  return v_new;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.is_platform_ops() from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.rule_versions_list() from public, anon;
revoke execute on function public.create_rule_version(text, text, date, text) from public, anon;
revoke execute on function public.publish_rule_version(uuid, boolean) from public, anon;
revoke execute on function public.rule_reprocess_progress(uuid) from public, anon;
revoke execute on function public.platform_ops_overview() from public, anon;
revoke execute on function public.retry_job(uuid) from public, anon;

grant execute on function public.is_platform_ops() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.rule_versions_list() to authenticated;
grant execute on function public.create_rule_version(text, text, date, text) to authenticated;
grant execute on function public.publish_rule_version(uuid, boolean) to authenticated;
grant execute on function public.rule_reprocess_progress(uuid) to authenticated;
grant execute on function public.platform_ops_overview() to authenticated;
grant execute on function public.retry_job(uuid) to authenticated;