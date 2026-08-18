-- Migration 20260817180957 (0012_data_plane_rls_grants) — exportada de supabase_migrations.schema_migrations
-- RLS de leitura por escopo em todo o plano de dados
do $$ declare t text; begin
  foreach t in array array['counterparties','invoices','invoice_items','receivables',
                           'tax_cash_events','products','price_scenarios','price_lines',
                           'regime_simulations','bank_accounts','bank_transactions',
                           'alerts','jobs','integrations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (in_scope(tenant_id))', t||'_select', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- Escrita pelo front: só onde o usuário decide, e só com papel adequado
create policy products_write on products for all to authenticated
  using (role_in(tenant_id) in ('owner','commercial')) with check (role_in(tenant_id) in ('owner','commercial'));
grant insert, update, delete on products to authenticated;

create policy scenarios_write on price_scenarios for all to authenticated
  using (role_in(tenant_id) in ('owner','commercial')) with check (role_in(tenant_id) in ('owner','commercial'));
grant insert, update, delete on price_scenarios to authenticated;

create policy alerts_update on alerts for update to authenticated
  using (in_scope(tenant_id)) with check (in_scope(tenant_id));
grant update on alerts to authenticated;

create policy integrations_write on integrations for all to authenticated
  using (can_admin(tenant_id) or role_in(tenant_id)='finance')
  with check (can_admin(tenant_id) or role_in(tenant_id)='finance');
grant insert, update, delete on integrations to authenticated;

-- mv_cash_timeline: não exposta direto (sem RLS em matview); leitura só via RPC
revoke all on mv_cash_timeline from anon, authenticated;
grant select on mv_cash_timeline to service_role;

grant usage, select on all sequences in schema public to service_role;
revoke execute on all functions in schema public from anon;
