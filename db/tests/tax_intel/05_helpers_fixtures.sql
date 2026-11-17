-- Ajudantes de teste e árvore de tenants sintética. SÓ PARA TESTE.
create schema t;
grant usage on schema t to anon, authenticated;

create table t.results (
  id serial primary key,
  suite text not null,
  name text not null,
  ok boolean not null,
  detail text
);
grant insert, select on t.results to anon, authenticated;
grant usage on sequence t.results_id_seq to anon, authenticated;

create function t.suite() returns text language sql stable as $$
  select coalesce(nullif(current_setting('t.suite', true), ''), '?')
$$;

create function t.ok(p_name text, p_cond boolean, p_detail text default null) returns void
language plpgsql as $$
begin
  insert into t.results (suite, name, ok, detail) values (t.suite(), p_name, coalesce(p_cond, false), p_detail);
  if coalesce(p_cond, false) then
    raise notice 'PASS  %', p_name;
  else
    raise notice 'FAIL  %  %', p_name, coalesce(p_detail, '');
  end if;
end $$;

create function t.eq(p_name text, p_got anyelement, p_want anyelement) returns void
language plpgsql as $$
begin
  perform t.ok(p_name, p_got is not distinct from p_want,
               format('esperado %s, obtido %s', p_want, p_got));
end $$;

-- Executa SQL e exige erro cujo texto contenha p_like (ou qualquer erro se nulo).
create function t.throws(p_name text, p_sql text, p_like text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform t.ok(p_name, p_like is null or sqlerrm ilike '%' || p_like || '%',
                 'erro: ' || sqlerrm);
    return;
  end;
  perform t.ok(p_name, false, 'não deu erro');
end $$;

create function t.lives(p_name text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  perform t.ok(p_name, true);
exception when others then
  perform t.ok(p_name, false, 'erro: ' || sqlerrm);
end $$;

grant execute on all functions in schema t to anon, authenticated;

-- Gera CNPJ válido a partir de 12 posições. Implementação independente da
-- testada (tabela de pesos explícita), para não testar a função contra ela mesma.
create function t.cnpj(p12 text) returns text language plpgsql immutable as $$
declare
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int := 0; d1 int; d2 int; i int; v text := upper(p12);
begin
  for i in 1..12 loop s := s + (ascii(substr(v, i, 1)) - 48) * w1[i]; end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  v := v || d1::text; s := 0;
  for i in 1..13 loop s := s + (ascii(substr(v, i, 1)) - 48) * w2[i]; end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return v || d2::text;
end $$;
grant execute on function t.cnpj(text) to anon, authenticated;

-- Identidade da sessão como o PostgREST faz: claims + role.
create function t.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     case when p_user is null then '' else jsonb_build_object('sub', p_user, 'role', 'authenticated')::text end,
                     false);
end $$;
grant execute on function t.claims(uuid) to anon, authenticated;

-- Árvore: plataforma > canal C > empresa A > unidade A1 ; plataforma > canal D > empresa B
create table t.ids (name text primary key, id uuid not null);
grant select on t.ids to anon, authenticated;
create function t.id(p text) returns uuid language sql stable as $$ select id from t.ids where name = p $$;
grant execute on function t.id(text) to anon, authenticated;

do $$
declare
  plat uuid := '00000000-0000-0000-0000-0000000000a0';
  ch_c uuid := '00000000-0000-0000-0000-0000000000c0';
  ch_d uuid := '00000000-0000-0000-0000-0000000000d0';
  co_a uuid := '00000000-0000-0000-0000-00000000a000';
  un_a uuid := '00000000-0000-0000-0000-00000000a100';
  co_b uuid := '00000000-0000-0000-0000-00000000b000';
begin
  -- Uma linha por comando: o trigger de path lê o pai já gravado.
  insert into public.tenants (id, parent_id, path, level, kind, name) values (plat, null, 'x', 0, 'platform', 'Plataforma');
  insert into public.tenants (id, parent_id, path, level, kind, name) values (ch_c, plat, 'x', 0, 'channel', 'Canal C');
  insert into public.tenants (id, parent_id, path, level, kind, name) values (ch_d, plat, 'x', 0, 'channel', 'Canal D');
  insert into public.tenants (id, parent_id, path, level, kind, name) values (co_a, ch_c, 'x', 0, 'company', 'Empresa A');
  insert into public.tenants (id, parent_id, path, level, kind, name) values (un_a, co_a, 'x', 0, 'unit', 'Unidade A1');
  insert into public.tenants (id, parent_id, path, level, kind, name) values (co_b, ch_d, 'x', 0, 'company', 'Empresa B');
  insert into t.ids values ('plat', plat), ('ch_c', ch_c), ('ch_d', ch_d),
                           ('co_a', co_a), ('un_a', un_a), ('co_b', co_b);
end $$;

-- Um usuário por papel. Nome = papel@tenant.
do $$
declare r record; v uuid;
begin
  for r in select * from (values
      ('platform_admin', 'plat'), ('platform_ops', 'plat'), ('platform_risk', 'plat'),
      ('channel_admin', 'ch_c'), ('channel_analyst', 'ch_c'), ('channel_admin', 'ch_d'),
      ('owner', 'co_a'), ('finance', 'co_a'), ('commercial', 'co_a'), ('viewer', 'co_a'),
      ('owner', 'un_a'), ('owner', 'co_b'), ('viewer', 'co_b')) x(role, tenant)
  loop
    v := gen_random_uuid();
    insert into auth.users (id, email) values (v, r.role || '@' || r.tenant || '.test');
    insert into public.memberships (user_id, tenant_id, role) values (v, t.id(r.tenant), r.role::public.member_role);
    insert into t.ids values (r.role || '@' || r.tenant, v);
  end loop;
end $$;
