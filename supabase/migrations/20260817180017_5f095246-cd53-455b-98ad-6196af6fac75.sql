create schema if not exists _test;
create table if not exists _test.results (n text, expected text, got text, pass boolean);
truncate _test.results;

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

grant usage on schema _test to authenticated;
grant select, insert on _test.results to authenticated;
grant execute on function _test.as_user(text,text), _test.reset(), _test.record(text,text,text) to authenticated;

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

do $$
declare v_alfa uuid; v_beta uuid; v_fin uuid; v_got text;
begin
  select id into v_alfa from tenants where slug='alfa';
  select id into v_beta from tenants where name='Distribuidora Beta';
  select id into v_fin  from auth.users where email='fin@beta.dev';

  perform _test.as_user('canal@alfa.dev','aal1');
  begin perform invite_user(v_beta, 'x1@beta.dev'::citext, 'viewer'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f1) channel_admin aal1 invite_user', 'MFA required', v_got);

  perform _test.as_user('canal@alfa.dev','aal1');
  begin perform create_tenant(v_alfa, 'company', 'Empresa X', '12.345.678/0001-95'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f2) channel_admin aal1 create_tenant', 'MFA required', v_got);

  perform _test.as_user('canal@alfa.dev','aal1');
  begin perform set_member_role(v_beta, v_fin, 'commercial'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f3) channel_admin aal1 set_member_role', 'MFA required', v_got);

  perform _test.as_user('canal@alfa.dev','aal2');
  begin perform invite_user(v_beta, 'x2@beta.dev'::citext, 'viewer'); v_got := 'ok';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f4) channel_admin aal2 invite_user', 'ok', v_got);

  perform _test.as_user('dono@beta.dev','aal1');
  begin perform invite_user(v_beta, 'x3@beta.dev'::citext, 'finance'); v_got := 'ok';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f5) owner aal1 invite_user (sem MFA)', 'ok', v_got);

  perform _test.as_user('admin@fluxa.dev','aal1');
  begin perform create_tenant((select id from tenants where kind='platform'), 'channel', 'Canal Y', null, 'canal-y'); v_got := 'permitiu';
  exception when others then v_got := sqlerrm; end;
  perform _test.reset();
  perform _test.record('(f6) platform_admin aal1 create_tenant', 'MFA required', v_got);
end $$;