-- 0006_seed_dev.sql
-- Bloco 1.7 do documento 01 — seed SÓ para dev/staging. Dados 100% fictícios.
-- Decisão gravada (opção 1): os 5 usuários são inseridos direto em auth.users
-- com senha Teste@123456 e e-mail já confirmado.
--
-- Árvore:
--   platform "TECH-IVA"
--     └── channel "Contábil Alfa" (slug alfa)
--           └── company "Distribuidora Beta" (CNPJ 11.222.333/0001-81)
--                 └── unit "Beta — Filial 02" (CNPJ 11.222.333/0002-62)
--     └── company "Serviços Gama" (CNPJ 44.555.666/0001-77) — direto sob a platform
--
-- Usuários: admin@fluxa.dev (platform_admin) · canal@alfa.dev (channel_admin em Alfa)
--           dono@beta.dev (owner em Beta) · fin@beta.dev (finance em Beta)
--           viewer@gama.dev (viewer em Gama)

do $$
declare
  v_platform uuid; v_alfa uuid; v_beta uuid; v_filial uuid; v_gama uuid;
  v_admin  uuid := '11111111-1111-4111-8111-111111111111';
  v_canal  uuid := '22222222-2222-4222-8222-222222222222';
  v_dono   uuid := '33333333-3333-4333-8333-333333333333';
  v_fin    uuid := '44444444-4444-4444-8444-444444444444';
  v_viewer uuid := '55555555-5555-4555-8555-555555555555';
  v_pw text := crypt('Teste@123456', gen_salt('bf'));
  r record;
begin
  -- ------------------------------------------------------------------ usuários
  for r in
    select * from (values
      (v_admin,  'admin@fluxa.dev',  'Ana Admin (TECH-IVA)'),
      (v_canal,  'canal@alfa.dev',   'Carlos Canal (Contábil Alfa)'),
      (v_dono,   'dono@beta.dev',    'Débora Dona (Distribuidora Beta)'),
      (v_fin,    'fin@beta.dev',     'Felipe Financeiro (Beta)'),
      (v_viewer, 'viewer@gama.dev',  'Vera Viewer (Serviços Gama)')
    ) as t(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated',
      r.email, v_pw, now(), now(), now(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', r.full_name)
    ) on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), r.id, r.id::text, 'email',
            jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true),
            now(), now(), now())
    on conflict do nothing;

    insert into profiles (user_id, full_name) values (r.id, r.full_name)
      on conflict (user_id) do update set full_name = excluded.full_name;
  end loop;

  -- -------------------------------------------------------------------- tenants
  insert into tenants (parent_id, kind, name, slug, created_by)
    values (null, 'platform', 'TECH-IVA', 'tech-iva', v_admin) returning id into v_platform;

  insert into tenants (parent_id, kind, name, slug, created_by, brand)
    values (v_platform, 'channel', 'Contábil Alfa', 'alfa', v_admin,
            jsonb_build_object('primary','#3B82F6','accent','#22C55E'))
    returning id into v_alfa;

  insert into tenants (parent_id, kind, name, cnpj, created_by)
    values (v_alfa, 'company', 'Distribuidora Beta', '11.222.333/0001-81', v_admin)
    returning id into v_beta;

  insert into tenants (parent_id, kind, name, cnpj, created_by)
    values (v_beta, 'unit', 'Beta — Filial 02', '11.222.333/0002-62', v_admin)
    returning id into v_filial;

  insert into tenants (parent_id, kind, name, cnpj, created_by)
    values (v_platform, 'company', 'Serviços Gama', '44.555.666/0001-77', v_admin)
    returning id into v_gama;

  -- ---------------------------------------------------------------- memberships
  insert into memberships (user_id, tenant_id, role, created_by) values
    (v_admin,  v_platform, 'platform_admin', v_admin),
    (v_canal,  v_alfa,     'channel_admin',  v_admin),
    (v_dono,   v_beta,     'owner',          v_admin),
    (v_fin,    v_beta,     'finance',        v_admin),
    (v_viewer, v_gama,     'viewer',         v_admin)
  on conflict (user_id, tenant_id) do update set role = excluded.role;

  update profiles set last_tenant = v_platform where user_id = v_admin;
  update profiles set last_tenant = v_alfa     where user_id = v_canal;
  update profiles set last_tenant = v_beta     where user_id in (v_dono, v_fin);
  update profiles set last_tenant = v_gama     where user_id = v_viewer;

  -- --------------------------------------------------------------------- planos
  insert into plans (code, name, price_cents, limits, features) values
    ('starter','Starter',  9900,  '{"companies":1,"users":3,"invoices_month":500}',    '{"pricing":false,"credit":false}'),
    ('pro',    'Pro',      29900, '{"companies":1,"users":10,"invoices_month":5000}',  '{"pricing":true,"credit":false}'),
    ('scale',  'Scale',    79900, '{"companies":5,"users":30,"invoices_month":50000}', '{"pricing":true,"credit":true}'),
    ('channel','Canal',    0,     '{"companies":100,"users":50}',                      '{"pricing":true,"credit":true,"whitelabel":true}')
  on conflict (code) do nothing;

  insert into subscriptions (tenant_id, plan_id, status)
    select v_beta, id, 'active' from plans where code='pro';
  insert into subscriptions (tenant_id, plan_id, status)
    select v_gama, id, 'trialing' from plans where code='starter';
  insert into subscriptions (tenant_id, plan_id, status)
    select v_alfa, id, 'active' from plans where code='channel';

  -- -------------------------------------------------- versão de regra corrente
  insert into rule_versions (calc_version, cclasstrib_version, valid_from, published_by, published_at, notes, is_current)
  values ('2026.08.0', 'cclasstrib-2026.08', date '2026-08-01', v_admin, now(), 'Seed dev — versão corrente', true);
end $$;
