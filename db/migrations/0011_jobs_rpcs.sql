-- 0011_jobs_rpcs.sql — Documento 02, bloco B (jobs) + E (fila por tenant)
-- enqueue_job / cancel_job: security definer, checagem explícita de papel por kind, audit_log.

create or replace function job_kind_allowed(p_tenant uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r member_role;
begin
  if not in_scope(p_tenant) then return false; end if;
  if is_platform() then return true; end if;
  r := role_in(p_tenant);
  if r is null then return false; end if;
  if p_kind = 'reprocess_rules' then
    return false;                                   -- só plataforma
  elsif p_kind = 'price_scenario' then
    return r in ('owner','commercial','channel_admin','channel_analyst');
  elsif p_kind in ('ingest_dfe','classify_chain','compute_taxes','project_cash','regime_sim','bank_sync','ingest_erp') then
    return r in ('owner','finance','channel_admin','channel_analyst');
  end if;
  return false;
end $$;

create or replace function enqueue_job(p_tenant uuid, p_kind text, p_params jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not job_kind_allowed(p_tenant, p_kind) then
    raise exception 'forbidden: job % nao permitido neste tenant', p_kind using errcode = '42501';
  end if;
  -- fila por tenant: um job do mesmo kind por vez
  if exists (select 1 from jobs j where j.tenant_id = p_tenant and j.kind = p_kind
                                   and j.status in ('queued','running')) then
    raise exception 'job % ja esta na fila para este tenant', p_kind using errcode = '55006';
  end if;
  insert into jobs (tenant_id, kind, params, requested_by)
  values (p_tenant, p_kind, coalesce(p_params, '{}'::jsonb), auth.uid())
  returning id into v_id;
  perform log_audit(p_tenant, 'job.enqueue', 'jobs', v_id::text, null,
                    jsonb_build_object('kind', p_kind, 'params', coalesce(p_params, '{}'::jsonb)));
  return v_id;
end $$;

create or replace function cancel_job(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  select * into j from jobs where id = p_job;
  if j.id is null then raise exception 'job nao encontrado' using errcode = 'P0002'; end if;
  if not job_kind_allowed(j.tenant_id, j.kind) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if j.status not in ('queued','running') then
    raise exception 'job ja finalizado (%)', j.status using errcode = '55006';
  end if;
  update jobs set status = 'canceled', finished_at = now(), message = 'cancelado pelo usuario'
   where id = p_job;
  perform log_audit(j.tenant_id, 'job.cancel', 'jobs', p_job::text,
                    jsonb_build_object('status', j.status), jsonb_build_object('status', 'canceled'));
end $$;

revoke execute on function job_kind_allowed(uuid,text) from public, anon;
revoke execute on function enqueue_job(uuid,text,jsonb) from public, anon;
revoke execute on function cancel_job(uuid) from public, anon;
grant execute on function enqueue_job(uuid,text,jsonb) to authenticated;
grant execute on function cancel_job(uuid) to authenticated;

-- Realtime: front assina jobs filtrado por tenant_id
alter table jobs replica identity full;
do $$ begin
  alter publication supabase_realtime add table jobs;
exception when duplicate_object then null; end $$;
