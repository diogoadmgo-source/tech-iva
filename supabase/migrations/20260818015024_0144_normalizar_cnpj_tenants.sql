-- Migration 20260818015024 (0144_normalizar_cnpj_tenants) — exportada de supabase_migrations.schema_migrations
-- Faltou o backfill de tenants.cnpj na 0143: o gatilho já normalizava escritas
-- novas, mas as linhas existentes continuavam pontuadas. Ter os dois lados em
-- formatos diferentes é pior do que ter tudo pontuado — a validação do certificado
-- compara o CNPJ do titular com o CNPJ da empresa, e falharia por formatação.
update tenants set cnpj = so_digitos(cnpj) where cnpj is not null and cnpj <> so_digitos(cnpj);

update integration_credentials set subject_cnpj = so_digitos(subject_cnpj)
 where subject_cnpj is not null and subject_cnpj <> so_digitos(subject_cnpj);

-- gatilho próprio para a coluna subject_cnpj (nome de coluna diferente)
create or replace function normalizar_subject_cnpj() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.subject_cnpj := so_digitos(new.subject_cnpj);
  if new.subject_cnpj is not null and length(new.subject_cnpj) <> 14 then
    raise exception 'CNPJ do titular inválido (esperados 14 dígitos): %', new.subject_cnpj;
  end if;
  return new;
end $$;

create trigger trg_cnpj_credencial before insert or update of subject_cnpj on integration_credentials
  for each row execute function normalizar_subject_cnpj();

-- Guarda explícita: o certificado só é aceito se o titular for a própria empresa.
-- Agora a comparação é confiável, porque os dois lados estão no mesmo formato.
create or replace function certificado_confere_titular(p_tenant uuid, p_subject_cnpj text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select so_digitos(p_subject_cnpj) is not null
     and so_digitos(p_subject_cnpj) = (select so_digitos(cnpj) from tenants where id = p_tenant);
$$;
revoke execute on function certificado_confere_titular(uuid,text) from public, anon, authenticated;
grant execute on function certificado_confere_titular(uuid,text) to service_role;
