-- ############################################################################
-- # BOOTSTRAP DE PRODUÇÃO — techiva-prod (ref rydatuiirsikmqebhqao)          #
-- #                                                                          #
-- # Roda UMA vez, depois de aplicar todas as db/migrations/*.sql.            #
-- # NÃO contém dados fictícios, nem usuários de teste, nem notas de exemplo.  #
-- # NUNCA aplique db/seeds/0006_seed_dev.sql nem 0018/0019 em produção.       #
-- ############################################################################
--
-- O que este arquivo cria:
--   1. o tenant raiz da plataforma (D T DUTRA) e sua identidade fiscal;
--   2. o catálogo de planos comerciais;
--   3. a versão de regra fiscal corrente (sem ela a calculadora não assina cálculo);
--   4. os avisos institucionais — vêm da migration 0121c, não daqui;
--   5. o tenant da empresa piloto (GDB), com o módulo de crédito DESLIGADO.
--
-- O que este arquivo NÃO faz:
--   - não cria usuários. As pessoas entram por convite/signup normal, com e-mail
--     confirmado e MFA. Inserir usuário direto em auth.users é prática de dev.
--   - o primeiro platform_admin é ligado no PASSO 2, no fim deste arquivo.

-- ===========================================================================
-- AJUSTE ANTES DE RODAR
-- ===========================================================================
-- Confirme o CNPJ do piloto. Se ainda não tiver, deixe 'PREENCHER': o script
-- cria a plataforma e os planos e apenas pula a criação do piloto.
-- ===========================================================================

do $$
declare
  -- plataforma (dados reais, usados na tela de autorização do e-CAC)
  c_plat_nome   text := 'TECH-IVA';
  c_plat_cnpj   text := '61.421.466/0001-55';
  c_plat_razao  text := 'D T DUTRA SERVICOS DIGITAIS LTDA';

  -- empresa piloto
  c_gdb_nome    text := 'GDB';
  c_gdb_cnpj    text := 'PREENCHER';   -- <<< CNPJ do piloto, formato 00.000.000/0000-00

  v_platform uuid;
  v_gdb      uuid;
begin
  -- ------------------------------------------------------------- 1. plataforma
  select id into v_platform from tenants where kind = 'platform' limit 1;

  if v_platform is null then
    insert into tenants (parent_id, kind, name, slug, cnpj, settings)
    values (null, 'platform', c_plat_nome, 'tech-iva', c_plat_cnpj,
            jsonb_build_object('identity', jsonb_build_object(
              'cnpj', c_plat_cnpj, 'razao_social', c_plat_razao, 'nome_exibicao', c_plat_nome)))
    returning id into v_platform;
    raise notice 'plataforma criada: %', v_platform;
  else
    -- idempotente: reafirma a identidade sem passar por set_platform_identity
    -- (aquela função exige sessão com MFA; aqui rodamos como service role).
    update tenants
       set settings = coalesce(settings,'{}'::jsonb) ||
             jsonb_build_object('identity', jsonb_build_object(
               'cnpj', c_plat_cnpj, 'razao_social', c_plat_razao, 'nome_exibicao', c_plat_nome)),
           cnpj = coalesce(cnpj, c_plat_cnpj)
     where id = v_platform;
    raise notice 'plataforma já existia: % (identidade atualizada)', v_platform;
  end if;

  -- ------------------------------------------------------------- 2. planos
  insert into plans (code, name, price_cents, limits, features) values
    ('starter','Starter',  9900,  '{"companies":1,"users":3,"invoices_month":500}',    '{"pricing":false,"credit":false}'),
    ('pro',    'Pro',      29900, '{"companies":1,"users":10,"invoices_month":5000}',  '{"pricing":true,"credit":false}'),
    ('scale',  'Scale',    79900, '{"companies":5,"users":30,"invoices_month":50000}', '{"pricing":true,"credit":false}'),
    ('channel','Canal',    0,     '{"companies":100,"users":50}',                      '{"pricing":true,"credit":false,"whitelabel":true}')
  on conflict (code) do nothing;
  -- credit=false em TODOS os planos: o módulo de financiamento está construído
  -- mas desligado. Ligar é decisão comercial, feita por tenant em /features.

  -- --------------------------------------------- 3. versão de regra corrente
  -- Sem uma linha is_current a assinatura de cálculo não fecha e o simulador
  -- recusa gravar. As datas acompanham a última publicação da RFB.
  if not exists (select 1 from rule_versions where is_current) then
    insert into rule_versions (calc_version, cclasstrib_version, valid_from, published_at, notes, is_current)
    values ('2026.08.0', 'cclasstrib-2026.08', date '2026-08-01', now(),
            'Bootstrap de produção — versão vigente no momento da implantação', true);
  end if;

  -- ------------------------------------------------------------- 4. piloto GDB
  if c_gdb_cnpj = 'PREENCHER' then
    raise notice 'piloto GDB NÃO criado: preencha c_gdb_cnpj e rode este arquivo de novo.';
  else
    select id into v_gdb from tenants where cnpj = c_gdb_cnpj;
    if v_gdb is null then
      insert into tenants (parent_id, kind, name, cnpj)
      values (v_platform, 'company', c_gdb_nome, c_gdb_cnpj)
      returning id into v_gdb;
      raise notice 'piloto GDB criado: %', v_gdb;
    end if;

    insert into subscriptions (tenant_id, plan_id, status)
      select v_gdb, id, 'active' from plans where code = 'pro'
      on conflict do nothing;

    -- crédito explicitamente desligado (não depender do default)
    insert into tenant_features (tenant_id, feature, enabled, note)
    values (v_gdb, 'credit', false, 'Desligado no bootstrap — ativação é decisão comercial')
    on conflict (tenant_id, feature) do update set enabled = false;
  end if;
end $$;

-- ===========================================================================
-- PASSO 2 — primeiro administrador da plataforma (rode DEPOIS do signup)
-- ===========================================================================
-- 1. A pessoa se cadastra normalmente em /signup e confirma o e-mail.
-- 2. Ela cadastra o app autenticador em /mfa (obrigatório para platform_admin).
-- 3. Troque o e-mail abaixo, descomente e rode:
--
-- insert into memberships (user_id, tenant_id, role)
-- select u.id, t.id, 'platform_admin'
--   from auth.users u, tenants t
--  where u.email = 'trocar@dominio.com.br'
--    and t.kind = 'platform'
--    and u.email_confirmed_at is not null   -- recusa conta não confirmada
-- on conflict (user_id, tenant_id) do update set role = 'platform_admin';
--
-- Confira depois:  select * from my_tenants();

-- ===========================================================================
-- VERIFICAÇÃO
-- ===========================================================================
-- select kind, name, cnpj, path from tenants order by path;
-- select code, name, price_cents, features->>'credit' as credito from plans order by price_cents;
-- select key, scope, severity from platform_notices where active order by scope, key;
-- select calc_version, cclasstrib_version, is_current from rule_versions;
-- select count(*) as deve_ser_zero from invoices;
