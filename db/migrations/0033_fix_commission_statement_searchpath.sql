-- 0033_fix_commission_statement_searchpath.sql
alter function public.channel_commission_statement(uuid, date) set search_path to 'public', 'extensions';