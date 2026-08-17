-- acceptance_a_f.sql — testes de aceite (a)–(f) do PASSO 1, com os 5 usuários do seed.
-- Rodar somente DEPOIS de 0001..0006 aplicadas, como superusuário/postgres:
--   psql -f db/tests/acceptance_a_f.sql
--
-- Cada bloco simula um usuário via GUC request.jwt.claims (sub + aal) e role authenticated,
-- exatamente como o PostgREST faz. Saída: uma linha por teste com PASS/FAIL.

\set ON_ERROR_STOP off
\timing off

create schema if not exists _test;
create table if not exists _test.results (n text, expected text, got text, pass boolean);
truncate _test.results;

-- Helper: aplica identidade de usuário
create or replace function _test.as_user(p_email text, p_aal text default 'aal2') returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then raise exception 'seed user % not found', p_email; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role','authenticated', 'aal', p_aal, 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
  return v_id;
end $$;

create or replace function _test.reset() returns void language plpgsql as $$
begin
  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims','', true);
end $$;

create or replace function _test.record(p_n text, p_expected text, p_got text) returns void
language sql as $$
  insert into _test.results values (p_n, p_expected, p_got, p_expected = p_got);
$$;

-- ============================================================ (a) select * from tenants
do $$
declare r record; v_list text;
begin
  for r in select * from (values
      ('admin@fluxa.dev','FLUXA|Contábil Alfa|Distribuidora Beta|Beta — Filial 02|Serviços Gama'),
      ('canal@alfa.dev','Contábil Alfa|Distribuidora Beta|Beta — Filial 02'),
      ('dono@beta.dev','Distribuidora Beta|Beta — Filial 02'),
      ('fin@beta.dev','Distribuidora Beta|Beta — Filial 02'),
      ('viewer@gama.dev','Serviços Gama')
    ) as t(email, expected)
  loop
    perform _test.as_user(r.email);
    select string_agg(name, '|' order by path::text) into v_list from tenants;
    perform _test.reset();
    perform _test.record('(a) tenants visíveis — '||r.email, r.expected, coalesce(v_list,'(vazio)'));
  end loop;
end $$;

-- ============================================================ (b) finance → invite_user
do $$
declare v_beta uuid; v_got text;
begin
  select id into v_beta from tenants where name='Distribuidora Beta';
  perform _test.as_user('fin@beta.dev');
  begin
    perform invite_user(v_beta, 'novo@beta.dev'::citext, 'viewer');
    v_got := 'permitiu';
  exception when others then v_got := sqlerrm;
  end;
  perform _test.reset();
  perform _test.record('(b) finance invite_user em Beta', 'forbidden', v_got);
end $$;

-- ================================================ (c) remove_member do último owner
do $$
declare v_beta uuid; v_dono uuid; v_got text;
begin
  select id into v_beta from tenants where name='Distribuidora Beta';
  select id into v_dono from auth.users where email='dono@beta.dev';
  perform _test.as_user('dono@beta.dev');
  begin
    perform remove_member(v_beta, v_dono);
    v_got := 'permitiu';
  exception when others then v_got := sqlerrm;
  end;
  perform _test.reset();
  perform _test.record('(c) remove_member último owner de Beta', 'cannot remove last admin', v_got);
end $$;

-- ============================================================ (d) update audit_log
do $$
declare v_got text;
begin
  perform _test.as_user('admin@fluxa.dev');
  begin
    update audit_log set action = 'hack' where id = (select min(id) from audit_log);
    v_got := 'permitiu';
  exception when others then v_got := 'bloqueado: '||sqlerrm;
  end;
  perform _test.reset();
  perform _test.record('(d) update audit_log como authenticated', 'bloqueado',
                       case when v_got like 'bloqueado%' then 'bloqueado' else v_got end);
end $$;

-- also: delete
do $$
declare v_got text;
begin
  perform _test.as_user('admin@fluxa.dev');
  begin
    delete from audit_log where id = (select min(id) from audit_log);
    v_got := 'permitiu';
  exception when others then v_got := 'bloqueado';
  end;
  perform _test.reset();
  perform _test.record('(d) delete audit_log como authenticated', 'bloqueado', v_got);
end $$;

-- ================================================ (e) create_tenant(unit sob channel)
do $$
declare v_alfa uuid; v_got text;
begin
  select id into v_alfa from tenants where slug='alfa';
  perform _test.as_user('canal@alfa.dev');
  begin
    perform create_tenant(v_alfa, 'unit', 'Unidade Inválida', '99.888.777/0001-00');
    v_got := 'permitiu';
  exception when others then v_got := sqlerrm;
  end;
  perform _test.reset();
  perform _test.record('(e) create_tenant unit sob channel', 'unit must be under company', v_got);
end $$;

-- ============================================================== (f) MFA (AAL) obrigatório
-- channel_admin em AAL1 deve falhar com 'MFA required' e passar em AAL2.
-- owner (Beta) NÃO exige MFA para RPCs de gestão.
do $$
declare v_alfa uuid; v_beta uuid; v_fin uuid; v_got text;
begin
  select id into v_alfa from tenants where slug='alfa';
  select id into v_beta from tenants where name='Distribuidora Beta';
  select id into v_fin  from auth.users where email='fin@beta.dev';

  -- f1: invite_user com channel_admin em aal1
  perform _test.as_user('canal@alfa.dev','aal1');
  begin perform invite_user(v_beta, 'x1@beta.dev'::citext, 'viewer'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f1) channel_admin aal1 invite_user', 'MFA required', v_got);

  -- f2: create_tenant com channel_admin em aal1
  perform _test.as_user('canal@alfa.dev','aal1');
  begin perform create_tenant(v_alfa, 'company', 'Empresa X', '12.345.678/0001-95'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f2) channel_admin aal1 create_tenant', 'MFA required', v_got);

  -- f3: set_member_role com channel_admin em aal1
  perform _test.as_user('canal@alfa.dev','aal1');
  begin perform set_member_role(v_beta, v_fin, 'commercial'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f3) channel_admin aal1 set_member_role', 'MFA required', v_got);

  -- f4: mesmo channel_admin em aal2 passa (rollback via savepoint implícito do bloco)
  perform _test.as_user('canal@alfa.dev','aal2');
  begin perform invite_user(v_beta, 'x2@beta.dev'::citext, 'viewer'); v_got := 'ok';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f4) channel_admin aal2 invite_user', 'ok', v_got);

  -- f5: owner em aal1 NÃO precisa de MFA
  perform _test.as_user('dono@beta.dev','aal1');
  begin perform invite_user(v_beta, 'x3@beta.dev'::citext, 'finance'); v_got := 'ok';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f5) owner aal1 invite_user (sem MFA)', 'ok', v_got);

  -- f6: platform_admin em aal1 deve falhar
  perform _test.as_user('admin@fluxa.dev','aal1');
  begin perform create_tenant((select id from tenants where kind='platform'), 'channel', 'Canal Y', null, 'canal-y'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f6) platform_admin aal1 create_tenant', 'MFA required', v_got);
end $$;

-- =============================================================== resultado final
select n as teste, expected as esperado, got as obtido,
       case when pass then 'PASS' else 'FAIL' end as status
from _test.results order by n;

select count(*) filter (where pass) as passou, count(*) filter (where not pass) as falhou
from _test.results;
