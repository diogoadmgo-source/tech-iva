do $$
declare v_t uuid;
begin
  select id into v_t from tenants where name='ZZ Seed Validacao TMP';
  if v_t is null then return; end if;
  delete from tax_cash_events where tenant_id=v_t;
  delete from receivables where tenant_id=v_t;
  delete from invoice_items where tenant_id=v_t;
  delete from invoices where tenant_id=v_t;
  delete from alerts where tenant_id=v_t;
  delete from counterparties where tenant_id=v_t;
  delete from tenants where id=v_t;
  perform refresh_cash_timeline();
end $$;