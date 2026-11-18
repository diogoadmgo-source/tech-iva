-- Cenário de preço: situação só muda pelas RPCs oficiais (escrita direta do cliente não altera status)
create or replace function public.price_scenarios_guard_status()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if current_user = 'authenticated'
     and (tg_op = 'INSERT' and coalesce(new.status::text,'draft') not in ('draft')
          or tg_op = 'UPDATE' and new.status is distinct from old.status) then
    raise exception 'Use a aprovação oficial para mudar a situação do cenário' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.price_scenarios_guard_status() from public, anon, authenticated;
drop trigger if exists price_scenarios_guard_status on public.price_scenarios;
create trigger price_scenarios_guard_status before insert or update on public.price_scenarios
  for each row execute function public.price_scenarios_guard_status();
