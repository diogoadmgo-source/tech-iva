revoke execute on function channel_commission_statement(uuid, date) from supabase_read_only_user;
revoke execute on function channel_commission_statement(uuid, date) from postgres;
revoke execute on function set_commission_rule(uuid, numeric, numeric, text) from postgres;
insert into public.commission_rules (tenant_id, mrr_pct, credit_pct, note)
select '40bb64ba-6a44-4a90-b601-41917615525d', 20.00, 1.00, 'contrato padrão de canal'
where not exists (select 1 from public.commission_rules
                  where tenant_id = '40bb64ba-6a44-4a90-b601-41917615525d' and is_current);