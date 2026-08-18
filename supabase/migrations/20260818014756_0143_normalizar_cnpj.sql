-- Migration 20260818014756 (0143_normalizar_cnpj) — exportada de supabase_migrations.schema_migrations
-- ============================================================================
-- NORMALIZAÇÃO DE CNPJ — corrige um risco de integridade, não só de busca
-- ============================================================================
-- O agente notou formatos misturados em counterparties.cnpj (uns com 14 dígitos,
-- outros pontuados) ao investigar a busca. O problema é maior que performance:
--
-- a unicidade é (tenant_id, cnpj) sobre o TEXTO CRU. Então '11222333000181' e
-- '11.222.333/0001-81' são chaves diferentes e convivem como DUAS contrapartes.
-- Consequência: o mesmo cliente aparece duplicado na Carteira, com a receita
-- dividida entre as duas linhas, e a participação de cada um sai pela metade.
-- Ninguém percebe — os números continuam plausíveis.
--
-- Isso ia acontecer no piloto: o ingestor grava o CNPJ como vem do XML (só
-- dígitos) e o cadastro manual grava pontuado.
--
-- DECISÃO: armazenar SEMPRE 14 dígitos. Formatação é responsabilidade da tela.
-- Com isso a busca por CNPJ volta a poder usar prefixo (barato) em vez de
-- trigram infixo, e a unicidade passa a valer de verdade.

-- 1. normalizador reaproveitável
create or replace function so_digitos(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select nullif(regexp_replace(coalesce(p,''), '\D', '', 'g'), '');
$$;
grant execute on function so_digitos(text) to authenticated, service_role;

-- 2. backfill: junta duplicatas antes de normalizar (aqui não há, mas o script
--    precisa ser seguro em qualquer ambiente)
do $$
declare r record;
begin
  for r in
    select tenant_id, so_digitos(cnpj) d, array_agg(id order by created_at) ids
    from counterparties
    where so_digitos(cnpj) is not null
    group by 1,2 having count(*) > 1
  loop
    -- move os vínculos para a linha mais antiga e apaga as demais
    update invoices set counterparty_id = r.ids[1]
     where counterparty_id = any(r.ids[2:]) and tenant_id = r.tenant_id;
    update price_lines set counterparty_id = r.ids[1]
     where counterparty_id = any(r.ids[2:]) and tenant_id = r.tenant_id;
    delete from counterparties where id = any(r.ids[2:]);
    raise notice 'CNPJ % tinha % linhas duplicadas por formato', r.d, array_length(r.ids,1);
  end loop;
end $$;

update counterparties set cnpj = so_digitos(cnpj) where cnpj <> so_digitos(cnpj);
update cnpj_registry  set cnpj = so_digitos(cnpj) where cnpj <> so_digitos(cnpj);

-- 3. trigger: entra pontuado, grava normalizado. Fecha a porta na origem,
--    em vez de confiar que todo caminho de escrita lembre de normalizar.
create or replace function normalizar_cnpj() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.cnpj := so_digitos(new.cnpj);
  if new.cnpj is not null and length(new.cnpj) <> 14 then
    raise exception 'CNPJ inválido (esperados 14 dígitos): %', new.cnpj;
  end if;
  return new;
end $$;

create trigger trg_cnpj_counterparties before insert or update of cnpj on counterparties
  for each row execute function normalizar_cnpj();
create trigger trg_cnpj_registry before insert or update of cnpj on cnpj_registry
  for each row execute function normalizar_cnpj();
create trigger trg_cnpj_tenants before insert or update of cnpj on tenants
  for each row execute function normalizar_cnpj();

-- 4. índice por prefixo agora funciona (a busca pode largar o trigram no CNPJ)
create index if not exists counterparties_cnpj_prefix on counterparties (tenant_id, cnpj text_pattern_ops);
