create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mrr_pct numeric(5,2) not null default 20.00,
  credit_pct numeric(5,2) not null default 1.00,
  note text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists commission_rules_current_uq
  on public.commission_rules (tenant_id) where is_current;

grant select on public.commission_rules to authenticated;
grant all on public.commission_rules to service_role;

alter table public.commission_rules enable row level security;

drop policy if exists commission_rules_read on public.commission_rules;
create policy commission_rules_read on public.commission_rules
  for select to authenticated using (in_scope(tenant_id));

drop policy if exists commission_rules_write on public.commission_rules;
create policy commission_rules_write on public.commission_rules
  for all to authenticated using (is_platform()) with check (is_platform());

drop trigger if exists commission_rules_audit on public.commission_rules;
create trigger commission_rules_audit
  after insert or update or delete on public.commission_rules
  for each row execute function audit_row();

create or replace function set_commission_rule(
  p_tenant uuid,
  p_mrr_pct numeric,
  p_credit_pct numeric,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_platform() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_mrr_pct < 0 or p_mrr_pct > 100 or p_credit_pct < 0 or p_credit_pct > 100 then
    raise exception 'percentual invalido' using errcode = '22023';
  end if;

  update commission_rules set is_current = false
   where tenant_id = p_tenant and is_current;

  insert into commission_rules (tenant_id, mrr_pct, credit_pct, note, created_by)
  values (p_tenant, p_mrr_pct, p_credit_pct, nullif(p_note, ''), auth.uid())
  returning id into v_id;

  perform log_audit(p_tenant, 'commission.rule_set', 'commission_rules', v_id::text, null,
                    jsonb_build_object('mrr_pct', p_mrr_pct, 'credit_pct', p_credit_pct));
  return v_id;
end $$;

create or replace function channel_commission_statement(
  p_tenant uuid,
  p_month date default date_trunc('month', current_date)::date
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_path ltree;
  v_kind tenant_kind;
  v_mrr_pct numeric := 20.00;
  v_credit_pct numeric := 1.00;
  v_month date := date_trunc('month', p_month)::date;
  v_lines jsonb;
  v_rule jsonb;
begin
  if not in_scope(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select t.path, t.kind into v_path, v_kind from tenants t where t.id = p_tenant;
  if v_path is null then
    raise exception 'tenant nao encontrado' using errcode = 'P0002';
  end if;

  select r.mrr_pct, r.credit_pct,
         jsonb_build_object('id', r.id, 'mrr_pct', r.mrr_pct, 'credit_pct', r.credit_pct,
                            'note', r.note, 'created_at', r.created_at)
    into v_mrr_pct, v_credit_pct, v_rule
    from commission_rules r
   where r.tenant_id = p_tenant and r.is_current
   limit 1;

  v_mrr_pct := coalesce(v_mrr_pct, 20.00);
  v_credit_pct := coalesce(v_credit_pct, 1.00);

  select coalesce(jsonb_agg(line order by line->>'name'), '[]'::jsonb) into v_lines
  from (
    select jsonb_build_object(
             'tenant_id', t.id,
             'name', t.name,
             'cnpj', t.cnpj,
             'plan_code', p.code,
             'plan_name', p.name,
             'status', s.status,
             'started_at', s.started_at,
             'mrr_cents', coalesce(p.price_cents, 0),
             'commission_cents',
               floor(coalesce(p.price_cents, 0) * v_mrr_pct / 100.0)::bigint,
             'billable',
               (s.status = 'active'
                and date_trunc('month', s.started_at)::date <= v_month
                and (s.ends_at is null or s.ends_at >= v_month))
           ) as line
      from tenants t
      left join subscriptions s on s.tenant_id = t.id
      left join plans p on p.id = s.plan_id
     where t.path <@ v_path
       and t.id <> p_tenant
       and t.kind in ('company','unit')
       and t.status = 'active'
  ) src;

  return jsonb_build_object(
    'tenant_id', p_tenant,
    'tenant_kind', v_kind,
    'month', v_month,
    'rule', coalesce(v_rule, jsonb_build_object('mrr_pct', v_mrr_pct, 'credit_pct', v_credit_pct,
                                                'note', 'padrão da plataforma')),
    'lines', v_lines,
    'totals', jsonb_build_object(
      'companies', (select count(*) from jsonb_array_elements(v_lines)),
      'billable', (select count(*) from jsonb_array_elements(v_lines) l where (l->>'billable')::boolean),
      'mrr_cents', (select coalesce(sum((l->>'mrr_cents')::bigint), 0)
                      from jsonb_array_elements(v_lines) l where (l->>'billable')::boolean),
      'commission_cents', (select coalesce(sum((l->>'commission_cents')::bigint), 0)
                             from jsonb_array_elements(v_lines) l where (l->>'billable')::boolean)
    )
  );
end $$;

revoke execute on function set_commission_rule(uuid, numeric, numeric, text) from public, anon;
revoke execute on function channel_commission_statement(uuid, date) from public, anon;
grant execute on function set_commission_rule(uuid, numeric, numeric, text) to authenticated;
grant execute on function channel_commission_statement(uuid, date) to authenticated;