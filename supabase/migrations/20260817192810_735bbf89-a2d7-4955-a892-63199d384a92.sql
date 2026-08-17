insert into public.memberships (user_id, tenant_id, role, created_by)
select 'bd3cd68f-c8f1-4c19-ae7c-8f6ba63bf634'::uuid, t.id, 'platform_admin'::member_role, 'bd3cd68f-c8f1-4c19-ae7c-8f6ba63bf634'::uuid
from public.tenants t where t.kind = 'platform'
on conflict (user_id, tenant_id) do update set role = 'platform_admin';

insert into public.profiles (user_id, full_name)
values ('bd3cd68f-c8f1-4c19-ae7c-8f6ba63bf634'::uuid, 'Diogo Telles Dutra')
on conflict (user_id) do nothing;