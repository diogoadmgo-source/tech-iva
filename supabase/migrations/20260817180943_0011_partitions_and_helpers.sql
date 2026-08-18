-- Migration 20260817180943 (0011_partitions_and_helpers) — exportada de supabase_migrations.schema_migrations
-- Partições mensais de tax_cash_events + função que garante partição
create or replace function ensure_tce_partition(p_date date) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_start date := date_trunc('month', p_date)::date;
        v_end   date := (date_trunc('month', p_date) + interval '1 month')::date;
        v_name  text := 'tax_cash_events_' || to_char(v_start,'YYYYMM');
begin
  if not exists (select 1 from pg_class where relname = v_name) then
    execute format('create table %I partition of tax_cash_events for values from (%L) to (%L)', v_name, v_start, v_end);
    execute format('alter table %I enable row level security', v_name);
  end if;
end $$;

-- Partição default para não perder inserts fora da faixa
create table tax_cash_events_default partition of tax_cash_events default;

-- Cria 24 meses a partir de jan/2026
do $$
declare d date := date '2026-01-01';
begin
  while d < date '2028-01-01' loop
    perform ensure_tce_partition(d);
    d := (d + interval '1 month')::date;
  end loop;
end $$;

-- View materializada da timeline de caixa
create materialized view mv_cash_timeline as
select tenant_id,
       date_trunc('week', event_date)::date as week,
       sum(case when kind='tax_out' then amount_cents else 0 end) as tax_out_cents,
       sum(case when kind='credit_in' then amount_cents else 0 end) as credit_in_cents,
       sum(case when kind='tax_out' then -amount_cents
                when kind='credit_in' then amount_cents
                when kind='loan_in' then amount_cents
                when kind='loan_out' then -amount_cents
                else 0 end) as net_cents,
       avg(confidence) as confidence
from tax_cash_events
group by 1,2;
create unique index mv_cash_timeline_pk on mv_cash_timeline (tenant_id, week);

create or replace function refresh_cash_timeline() returns void
language sql security definer set search_path = public, extensions as $$
  refresh materialized view concurrently mv_cash_timeline;
$$;
revoke execute on function refresh_cash_timeline(), ensure_tce_partition(date) from public, anon, authenticated;
