-- 0221: renomeia os planos comerciais para Bronze / Prata / Ouro.
update public.plans set name = 'Bronze' where code = 'starter';
update public.plans set name = 'Prata'  where code = 'pro';
update public.plans set name = 'Ouro'   where code = 'scale';
