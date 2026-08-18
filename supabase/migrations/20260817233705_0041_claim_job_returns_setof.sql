-- Migration 20260817233705 (0041_claim_job_returns_setof) — exportada de supabase_migrations.schema_migrations
-- BUG: "returns jobs" devolve uma linha de campos NULL quando não há job,
-- e o worker interpretava isso como job válido (kind null) -> loop de erro.
-- "returns setof jobs" devolve conjunto vazio, que é o correto.
drop function if exists claim_job(text[], text, int);

create or replace function claim_job(p_kinds text[], p_worker text, p_lease_seconds int default 300)
returns setof jobs language plpgsql security definer set search_path = public, extensions as $$
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
end $$;

revoke execute on function claim_job(text[],text,int) from public, anon, authenticated;
grant execute on function claim_job(text[],text,int) to service_role;
