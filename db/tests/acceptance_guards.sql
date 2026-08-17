-- acceptance_guards.sql — teste de regressão PERMANENTE de guardas de papel.
--
-- Motivação (falha real corrigida em 0030/0031/0032): guardas escritas como
--   if role_in(t) not in ('a','b') then raise exception 'forbidden'; end if;
-- NÃO disparam quando role_in() devolve NULL (usuário autenticado sem membership),
-- porque NULL NOT IN (...) = NULL e IF NULL não executa o corpo.
--
-- Este teste simula um usuário AUTENTICADO SEM NENHUMA MEMBERSHIP (sub aleatório,
-- role=authenticated, aal2) e chama todas as RPCs expostas a `authenticated`.
-- Resultado esperado de TODAS: exceção contendo 'forbidden' (ou 'MFA required'
-- / 'not found' quando o guard vem depois da busca da entidade).
-- Qualquer RPC que RETORNE DADO nesse cenário é FAIL.
--
-- Rodar como postgres/superusuário:
--   psql -f db/tests/acceptance_guards.sql
--   select * from _test.guard_results order by pass, rpc;

create schema if not exists _test;
create table if not exists _test.guard_results (
  rpc text, call_expr text, outcome text, detail text, pass boolean
);

do $$
declare
  v_ghost   uuid := gen_random_uuid();   -- usuário autenticado sem membership
  v_beta    uuid;
  v_gama    uuid;
  v_alfa    uuid;
  v_platform uuid;
  v_scenario uuid; v_line uuid; v_sim uuid; v_job uuid; v_alert uuid;
  v_offer uuid; v_contract uuid; v_member uuid; v_cp uuid; v_rule uuid;
  r record;
  v_rows jsonb := '[]'::jsonb;
  v_res text;
begin
  truncate _test.guard_results;

  select id into v_platform from tenants where kind = 'platform' order by created_at limit 1;
  select id into v_alfa from tenants where name = 'Contábil Alfa';
  select id into v_beta from tenants where name = 'Distribuidora Beta';
  select id into v_gama from tenants where name = 'Serviços Gama';
  select id into v_scenario from price_scenarios where tenant_id = v_beta limit 1;
  select id into v_line from products where tenant_id = v_beta limit 1;
  select id into v_sim from regime_simulations where tenant_id = v_beta limit 1;
  select id into v_job from jobs where tenant_id = v_beta limit 1;
  select id into v_alert from alerts limit 1;
  select id into v_offer from credit.offers where tenant_id = v_beta limit 1;
  select id into v_contract from credit.contracts where tenant_id = v_beta limit 1;
  select user_id into v_member from memberships where tenant_id = v_beta limit 1;
  select id into v_cp from counterparties where tenant_id = v_beta limit 1;
  select id into v_rule from rule_versions where is_current limit 1;

  -- identidade fantasma: autenticado, aal2, sem nenhuma membership
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ghost::text, 'role', 'authenticated',
                      'aal', 'aal2', 'email', 'ghost@example.com')::text, true);
  perform set_config('role', 'authenticated', true);

  for r in
    select * from (values
      -- RPCs cujo 1º argumento é o tenant (testadas contra Beta e Gama)
      ('dashboard_cash',               format('select dashboard_cash(%L::uuid, 90)', v_beta)),
      ('dashboard_cash/gama',          format('select dashboard_cash(%L::uuid, 90)', v_gama)),
      ('chain_map',                    format('select chain_map(%L::uuid, null, %L::jsonb)', v_beta, '{}')),
      ('channel_portfolio',            format('select channel_portfolio(%L::uuid, %L::jsonb)', v_alfa, '{}')),
      ('channel_portfolio/platform',   format('select channel_portfolio(%L::uuid, %L::jsonb)', v_platform, '{}')),
      ('channel_commission_statement', format('select channel_commission_statement(%L::uuid)', v_alfa)),
      ('regime_wallet_summary',        format('select regime_wallet_summary(%L::uuid)', v_beta)),
      ('run_regime_simulation',        format('select run_regime_simulation(%L::uuid, %L::jsonb)', v_beta, '{}')),
      ('tenant_members',               format('select count(*)::text from tenant_members(%L::uuid)', v_beta)),
      ('get_alert_prefs',              format('select get_alert_prefs(%L::uuid)', v_beta)),
      ('set_alert_prefs',              format('select set_alert_prefs(%L::uuid, %L::jsonb)', v_beta, '{}')),
      ('credit_offers',                format('select credit_offers(%L::uuid)', v_beta)),
      ('credit_contracts',             format('select credit_contracts(%L::uuid)', v_beta)),
      ('credit_generate_offers',       format('select credit_generate_offers(%L::uuid)', v_beta)),
      ('price_scenario_create',        format('select price_scenario_create(%L::uuid, %L, 20, 2027, null, 0)', v_beta, 'ghost')),
      ('invite_user',                  format('select invite_user(%L::uuid, %L, %L::member_role)', v_beta, 'ghost@example.com', 'viewer')),
      ('create_tenant',                format('select create_tenant(%L::uuid, %L::tenant_kind, %L)', v_beta, 'unit', 'Ghost Unit')),
      ('move_tenant',                  format('select move_tenant(%L::uuid, %L::uuid)', v_beta, v_gama)),
      ('set_commission_rule',          format('select set_commission_rule(%L::uuid, 10, 1)', v_alfa)),
      ('enqueue_job',                  format('select enqueue_job(%L::uuid, %L)', v_beta, 'compute_taxes')),
      ('counterparty_detail',          format('select counterparty_detail(%L::uuid, %L::uuid)', v_beta, v_cp)),
      ('mark_renegotiate',             format('select mark_renegotiate(%L::uuid, array[%L::uuid], %L)', v_beta, v_cp, 'ghost')),
      ('set_regime_manual',            format('select set_regime_manual(%L::uuid, %L::uuid, %L::regime_kind, %L)', v_beta, v_cp, 'real', 'ghost')),
      -- RPCs de plataforma
      ('platform_ops_overview',        'select platform_ops_overview()'),
      ('rule_versions_list',           'select rule_versions_list()'),
      ('create_rule_version',          format('select create_rule_version(%L, %L, %L::date, %L)', '9999.1', 'ghost', '2030-01-01', 'ghost')),
      ('publish_rule_version',         format('select publish_rule_version(%L::uuid, true)', v_rule)),
      ('rule_reprocess_progress',      format('select rule_reprocess_progress(%L::uuid)', v_rule)),
      -- RPCs por entidade
      ('price_scenario_detail',        format('select price_scenario_detail(%L::uuid)', v_scenario)),
      ('price_scenario_compute',       format('select price_scenario_compute(%L::uuid)', v_scenario)),
      ('approve_price_scenario',       format('select approve_price_scenario(%L::uuid)', v_scenario)),
      ('update_product_price',         format('select update_product_price(%L::uuid, 100, 200)', v_line)),
      ('share_regime_simulation',      format('select share_regime_simulation(%L::uuid)', v_sim)),
      ('retry_job',                    format('select retry_job(%L::uuid)', v_job)),
      ('cancel_job',                   format('select cancel_job(%L::uuid)', v_job)),
      ('ack_alert',                    format('select ack_alert(%L::uuid)', v_alert)),
      ('resolve_alert',                format('select resolve_alert(%L::uuid, %L)', v_alert, 'ghost')),
      ('credit_offer_detail',          format('select credit_offer_detail(%L::uuid)', v_offer)),
      ('accept_credit_offer',          format('select accept_credit_offer(%L::uuid)', v_offer)),
      ('credit_contract_detail',       format('select credit_contract_detail(%L::uuid)', v_contract)),
      ('set_member_role',              format('select set_member_role(%L::uuid, %L::uuid, %L::member_role)', v_beta, v_member, 'owner')),
      ('remove_member',                format('select remove_member(%L::uuid, %L::uuid)', v_beta, v_member))
    ) as t(rpc, call_expr)
  loop
    -- os resultados são acumulados em memória: durante o loop o papel corrente é
    -- `authenticated`, que (corretamente) não tem acesso ao schema _test.
    if r.call_expr like '%NULL%' or r.call_expr is null then
      v_rows := v_rows || jsonb_build_object('rpc', r.rpc, 'call_expr', r.call_expr,
        'outcome', 'SKIP', 'detail', 'entidade inexistente no seed', 'pass', true);
      continue;
    end if;
    begin
      execute r.call_expr into v_res;
      v_rows := v_rows || jsonb_build_object('rpc', r.rpc, 'call_expr', r.call_expr,
        'outcome', 'RETORNOU DADO', 'detail', left(coalesce(v_res, '(null)'), 200), 'pass', false);
    exception when others then
      v_rows := v_rows || jsonb_build_object('rpc', r.rpc, 'call_expr', r.call_expr,
        'outcome', 'EXCEPTION', 'detail', sqlerrm,
        'pass', sqlerrm ilike '%forbidden%' or sqlerrm ilike '%MFA required%'
                or sqlerrm ilike '%nao encontrad%' or sqlerrm ilike '%not found%'
                or sqlerrm ilike '%permission denied%');
    end;
  end loop;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into _test.guard_results (rpc, call_expr, outcome, detail, pass)
  select x->>'rpc', x->>'call_expr', x->>'outcome', x->>'detail', (x->>'pass')::boolean
  from jsonb_array_elements(v_rows) x;
end $$;


-- select * from _test.guard_results order by pass, rpc;
