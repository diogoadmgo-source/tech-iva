-- 0215: remove organizações fictícias de teste, mantendo apenas TECH-IVA (plataforma) e GDB
do $$
declare
  v_alfa   uuid := '40bb64ba-6a44-4a90-b601-41917615525d';
  v_beta   uuid := '115c460d-a8ca-4444-8518-708b8e8d275d';
  v_filial uuid := '5ae6425f-7946-401c-b55d-644eb14edae6';
  v_gama   uuid := '936f2b45-2482-49fc-bb9c-78ea220ad082';
begin
  update profiles set last_tenant = null
   where last_tenant in (v_alfa, v_beta, v_filial, v_gama);

  delete from tenants where id = v_filial;
  delete from tenants where id = v_beta;
  delete from tenants where id = v_alfa;
  delete from tenants where id = v_gama;
end $$;

-- usuários de teste do seed dev (sem vínculo restante)
delete from auth.users where email in (
  'canal@alfa.dev','dono@beta.dev','fin@beta.dev','viewer@gama.dev'
);