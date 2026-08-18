-- Migration 20260817224133 (0040_job_queue_contract) — exportada de supabase_migrations.schema_migrations
-- Contrato de fila entre o banco e os serviços em container (fluxa-services).
-- Só o service_role executa. Um job por tenant+kind de cada vez (SKIP LOCKED),
-- para que um tenant com 50 mil notas não trave a fila dos outros.

alter table jobs add column if not exists attempts int not null default 0;
alter table jobs add column if not exists next_attempt_at timestamptz;
alter table jobs add column if not exists lease_until timestamptz;
create index if not exists jobs_claimable on jobs (kind, queued_at)
  where status in ('queued','running');

create or replace function claim_job(p_kinds text[], p_worker text, p_lease_seconds int default 300)
returns jobs language plpgsql security definer set search_path = public, extensions as $$
declare v jobs;
begin
  select j.* into v from jobs j
   where j.kind = any(p_kinds)
     and (
       (j.status = 'queued' and coalesce(j.next_attempt_at, j.queued_at) <= now())
       or (j.status = 'running' and j.lease_until < now())   -- retoma job órfão
     )
     -- não pega se já existe outro job do mesmo tenant+kind rodando
     and not exists (
       select 1 from jobs o where o.tenant_id = j.tenant_id and o.kind = j.kind
         and o.status = 'running' and o.lease_until >= now() and o.id <> j.id
     )
   order by j.queued_at
   for update skip locked
   limit 1;

  if v.id is null then return null; end if;

  update jobs set status='running', started_at=coalesce(started_at, now()),
                  worker=p_worker, attempts=attempts+1,
                  lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = v.id returning * into v;
  return v;
end $$;

create or replace function report_job(p_job uuid, p_status job_status, p_progress numeric default null,
                                      p_message text default null, p_result jsonb default null,
                                      p_error text default null, p_lease_seconds int default 300)
returns void language plpgsql security definer set search_path = public, extensions as $$
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
end $$;

revoke execute on function claim_job(text[],text,int), report_job(uuid,job_status,numeric,text,jsonb,text,int)
  from public, anon, authenticated;
grant execute on function claim_job(text[],text,int), report_job(uuid,job_status,numeric,text,jsonb,text,int)
  to service_role;
