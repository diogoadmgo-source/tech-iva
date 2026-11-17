-- 0241 — Inteligência Tributária: importação de base (Fase 1)
-- ============================================================================
-- NÃO APLICADA. Depende da 0240.
--
-- Fluxo (até 100 mil linhas; meta de aceite: 70 mil):
--   1. tax_import_create     → registra a importação e devolve o caminho no
--                              Storage onde o arquivo original deve ser enviado.
--   2. upload do arquivo     → política do bucket só aceita esse caminho, de
--                              quem criou a importação, enquanto "recebendo".
--   3. tax_import_add_items  → lotes de até 1.000 linhas. O banco REVALIDA
--                              tudo (não confia no navegador). Idempotente por
--                              (import_id, row_number).
--   4. tax_import_finalize   → deduplica, separa o que já existia, cria
--                              entidades e relacionamentos, em trechos de até
--                              10 mil linhas por chamada (cabe no
--                              statement_timeout); o cliente repete até
--                              "done". Idempotente e retomável.
--   Retomada: o lote é uma transação; received_rows diz de onde continuar.
--
-- Segurança: todas security definer com search_path fixo, papel conferido em
-- cada chamada, entrada validada (tipo, tamanho, faixa), EXECUTE só para
-- authenticated. Toda operação grava tax_audit_logs e log_audit.
-- ============================================================================

-- Papéis que podem importar e atualizar (seção 3.5 da especificação).
create or replace function public.tax_can_write(p_tenant uuid)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select has_role(p_tenant, array['platform_admin', 'platform_ops', 'channel_admin',
                                  'owner', 'finance']::member_role[]);
$$;
revoke all on function public.tax_can_write(uuid) from public, anon, authenticated;

-- Tipo de relacionamento por texto livre. Nulo = célula vazia (usa o padrão
-- escolhido na importação); '{}' = texto não reconhecido.
-- Espelhado em src/lib/tax-intel/relationship.ts (mesmos casos de teste).
create or replace function public.tax_parse_relationship(p text)
returns public.tax_relationship_kind[]
language plpgsql immutable parallel safe
set search_path = public, pg_temp
as $$
declare
  v text := lower(btrim(translate(coalesce(p, ''),
                  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                  'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')));
begin
  v := regexp_replace(v, '[[:space:]]+', ' ', 'g');
  if v = '' then return null; end if;
  if v in ('cliente', 'clientes', 'c') then
    return array['cliente']::tax_relationship_kind[];
  end if;
  if v in ('fornecedor', 'fornecedores', 'f') then
    return array['fornecedor']::tax_relationship_kind[];
  end if;
  if v in ('ambos', 'cliente e fornecedor', 'fornecedor e cliente', 'cliente/fornecedor',
           'fornecedor/cliente', 'cliente;fornecedor', 'cliente,fornecedor', 'c/f', 'f/c', 'cf') then
    return array['cliente', 'fornecedor']::tax_relationship_kind[];
  end if;
  return '{}'::tax_relationship_kind[];
end $$;
revoke all on function public.tax_parse_relationship(text) from public, anon;
grant execute on function public.tax_parse_relationship(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Criar importação
-- ---------------------------------------------------------------------------
create or replace function public.tax_import_create(
  p_tenant uuid,
  p_file_name text,
  p_file_size bigint,
  p_file_sha256 text,
  p_file_kind text,
  p_sheet_name text,
  p_expected_rows integer,
  p_default_relationship public.tax_relationship_kind default null,
  p_first_data_line integer default 2)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_kind tenant_kind;
  v_safe_name text;
  v_path text;
  v_job uuid;
  v_previous jsonb;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_tenant is null or not tax_can_write(p_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select kind into v_kind from tenants where id = p_tenant and status = 'active';
  if v_kind is null or v_kind not in ('company', 'unit') then
    raise exception 'Importação disponível só para empresa ou unidade' using errcode = '22023';
  end if;

  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 200 then
    raise exception 'Nome de arquivo inválido' using errcode = '22023';
  end if;
  if p_file_kind is null or p_file_kind not in ('xlsx', 'csv') then
    raise exception 'Tipo de arquivo inválido: use XLSX ou CSV' using errcode = '22023';
  end if;
  if p_file_size is null or p_file_size not between 1 and 31457280 then
    raise exception 'Arquivo acima de 30 MB' using errcode = '22023';
  end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash do arquivo inválido' using errcode = '22023';
  end if;
  if p_expected_rows is null or p_expected_rows not between 1 and 100000 then
    raise exception 'O arquivo precisa ter entre 1 e 100.000 linhas' using errcode = '22023';
  end if;
  if p_first_data_line is null or p_first_data_line not between 1 and 100 then
    raise exception 'Linha inicial inválida' using errcode = '22023';
  end if;
  if p_sheet_name is not null and length(p_sheet_name) > 100 then
    raise exception 'Nome de aba inválido' using errcode = '22023';
  end if;

  -- O caminho é gerado aqui: o cliente não escolhe onde o arquivo mora.
  v_safe_name := left(regexp_replace(btrim(p_file_name), '[^A-Za-z0-9._-]+', '_', 'g'), 120);
  v_safe_name := regexp_replace(v_safe_name, '\.{2,}', '.', 'g');
  v_path := p_tenant::text || '/' || v_id::text || '/' || v_safe_name;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'status', i.status)
                            order by i.created_at desc), '[]'::jsonb)
    into v_previous
    from tax_imports i
   where i.tenant_id = p_tenant and i.file_sha256 = p_file_sha256 and i.status <> 'cancelada';

  insert into tax_imports (id, tenant_id, file_name, storage_path, file_size_bytes, file_sha256,
                           file_kind, sheet_name, expected_rows, default_relationship,
                           first_data_line, created_by)
  values (v_id, p_tenant, btrim(p_file_name), v_path, p_file_size, p_file_sha256,
          p_file_kind, p_sheet_name, p_expected_rows, p_default_relationship,
          p_first_data_line, auth.uid());

  insert into tax_processing_jobs (tenant_id, kind, import_id, total, created_by, heartbeat_at)
  values (p_tenant, 'importacao', v_id, p_expected_rows, auth.uid(), now())
  returning id into v_job;

  perform tax_audit(p_tenant, 'tax.import.create', 'tax_imports', v_id::text, null,
                    jsonb_build_object('file_name', btrim(p_file_name), 'file_sha256', p_file_sha256,
                                       'expected_rows', p_expected_rows, 'file_kind', p_file_kind,
                                       'default_relationship', p_default_relationship));
  perform log_audit(p_tenant, 'tax.import.create', 'tax_imports', v_id::text, null,
                    jsonb_build_object('expected_rows', p_expected_rows));

  return jsonb_build_object('import_id', v_id, 'job_id', v_job, 'storage_path', v_path,
                            'same_file_imports', v_previous);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Receber um lote (até 1.000 linhas)
-- ---------------------------------------------------------------------------
-- p_rows: [{"r": 1, "cnpj": "...", "razao": "...", "fantasia": "...", "rel": "..."}]
-- Qualquer elemento fora do formato rejeita o lote inteiro (nada é gravado).
create or replace function public.tax_import_add_items(p_import uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_imp tax_imports;
  v_n int;
  v_bad int;
  v_inserted int;
  v_received int;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Trava a importação: lotes concorrentes da mesma importação são serializados.
  select * into v_imp from tax_imports where id = p_import for update;
  if v_imp.id is null or not tax_can_write(v_imp.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_imp.status <> 'recebendo' then
    raise exception 'Importação não está recebendo linhas (status: %)', v_imp.status using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Lote inválido: esperado uma lista' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n not between 1 and 1000 then
    raise exception 'Lote inválido: de 1 a 1.000 linhas por chamada (recebido %)', v_n using errcode = '22023';
  end if;
  if octet_length(p_rows::text) > 2000000 then
    raise exception 'Lote inválido: acima de 2 MB' using errcode = '22023';
  end if;

  -- CASE garante a ordem de avaliação (o cast de "r" só roda depois de
  -- conferido o formato) e trata chave ausente como nula, não como erro.
  select count(*) into v_bad
    from jsonb_array_elements(p_rows) e
   where case
           when jsonb_typeof(e) is distinct from 'object' then true
           when jsonb_typeof(e->'r') is distinct from 'number' then true
           when (e->>'r') !~ '^[0-9]{1,6}$' then true
           when (e->>'r')::int not between 1 and v_imp.expected_rows then true
           when jsonb_typeof(e->'cnpj') not in ('string', 'null') then true
           when jsonb_typeof(e->'razao') not in ('string', 'null') then true
           when jsonb_typeof(e->'fantasia') not in ('string', 'null') then true
           when jsonb_typeof(e->'rel') not in ('string', 'null') then true
           when length(coalesce(e->>'cnpj', '')) > 64 then true
           when length(coalesce(e->>'razao', '')) > 300 then true
           when length(coalesce(e->>'fantasia', '')) > 300 then true
           when length(coalesce(e->>'rel', '')) > 60 then true
           when (select count(*) from jsonb_object_keys(e) k
                  where k not in ('r', 'cnpj', 'razao', 'fantasia', 'rel')) > 0 then true
           else false
         end;
  if v_bad > 0 then
    raise exception 'Lote inválido: % linha(s) fora do formato', v_bad using errcode = '22023';
  end if;

  select count(*) - count(distinct (e->>'r')::int) into v_bad from jsonb_array_elements(p_rows) e;
  if v_bad > 0 then
    raise exception 'Lote inválido: número de linha repetido no lote' using errcode = '22023';
  end if;

  with src as (
    select (e->>'r')::int as row_number,
           nullif(btrim(e->>'cnpj'), '') as cnpj_raw,
           nullif(btrim(e->>'razao'), '') as razao,
           nullif(btrim(e->>'fantasia'), '') as fantasia,
           nullif(btrim(e->>'rel'), '') as rel_raw
      from jsonb_array_elements(p_rows) e
  ), norm as (
    select s.*,
           tax_cnpj_strip(s.cnpj_raw) as stripped,
           coalesce(tax_parse_relationship(s.rel_raw),
                    case when v_imp.default_relationship is not null
                         then array[v_imp.default_relationship] end) as rels
      from src s
  ), padded as (
    -- Zeros à esquerda perdidos pelo Excel: só valor 100% numérico de 12 ou 13 dígitos.
    select n.*,
           case when n.stripped ~ '^[0-9]{12,13}$' then lpad(n.stripped, 14, '0') else n.stripped end as candidate,
           n.stripped ~ '^[0-9]{12,13}$' as was_padded
      from norm n
  )
  insert into tax_import_items (import_id, tenant_id, row_number, cnpj_raw, cnpj, normalization_note,
                                razao_social, nome_fantasia, relationship_raw, relationships, status, error)
  select p_import, v_imp.tenant_id, p.row_number, p.cnpj_raw,
         case when tax_cnpj_is_valid(p.candidate) then p.candidate end,
         case when p.was_padded and tax_cnpj_is_valid(p.candidate) then 'zeros à esquerda completados' end,
         p.razao, p.fantasia, p.rel_raw,
         case when cardinality(p.rels) > 0 then p.rels end,
         case
           when p.cnpj_raw is null then 'cnpj_ausente'
           when not tax_cnpj_is_valid(p.candidate) then 'cnpj_invalido'
           when p.rels is null or cardinality(p.rels) = 0 then 'relacionamento_invalido'
           else 'recebido'
         end::tax_import_item_status,
         case
           when p.cnpj_raw is null then 'CNPJ vazio'
           when p.candidate is null or p.candidate !~ '^[0-9A-Z]{12}[0-9]{2}$' then 'Formato inválido'
           when not tax_cnpj_is_valid(p.candidate) then 'Dígito verificador não confere'
           when p.rels is null then 'Tipo de relacionamento vazio e sem padrão definido'
           when cardinality(p.rels) = 0 then 'Tipo de relacionamento não reconhecido'
         end
    from padded p
  on conflict (import_id, row_number) do nothing;
  get diagnostics v_inserted = row_count;

  select count(*) into v_received from tax_import_items where import_id = p_import;
  update tax_imports set received_rows = v_received where id = p_import;
  update tax_processing_jobs set processed = v_received, heartbeat_at = now()
   where import_id = p_import and kind = 'importacao';

  return jsonb_build_object('received_rows', v_received, 'inserted', v_inserted,
                            'ignored_already_received', v_n - v_inserted,
                            'expected_rows', v_imp.expected_rows);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Finalizar (idempotente)
-- ---------------------------------------------------------------------------
create or replace function public.tax_import_finalize(p_import uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Cada chamada processa no máximo v_chunk linhas, para caber com folga no
  -- statement_timeout do papel authenticated no Supabase (8 s por padrão). O
  -- cliente chama de novo enquanto "done" for false. 70 mil linhas = 7 chamadas.
  v_chunk constant int := 10000;
  v_imp tax_imports;
  v_summary jsonb;
  v_new_rel int;
  v_upto int;
  v_remaining int;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_imp from tax_imports where id = p_import for update;
  if v_imp.id is null or not tax_can_write(v_imp.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_imp.status = 'concluida' then
    return tax_import_summary(v_imp) || jsonb_build_object('done', true);
  end if;
  if v_imp.status not in ('recebendo', 'finalizando') then
    raise exception 'Importação não pode ser finalizada (status: %)', v_imp.status using errcode = '22023';
  end if;
  if v_imp.received_rows < v_imp.expected_rows then
    raise exception 'Importação incompleta: recebidas % de % linhas', v_imp.received_rows, v_imp.expected_rows
      using errcode = '22023';
  end if;

  if v_imp.status = 'recebendo' then
    -- A partir daqui não entra arquivo nem linha nova, e não se cancela.
    update tax_imports set status = 'finalizando' where id = p_import;
  end if;

  -- Serializa finalizações do mesmo tenant: "novo × já existente" fica exato.
  perform pg_advisory_xact_lock(hashtextextended('tax_import_finalize:' || v_imp.tenant_id::text, 0));

  -- Próximo trecho: as v_chunk primeiras linhas ainda "recebido", em ordem.
  select max(row_number) into v_upto
    from (select row_number from tax_import_items
           where import_id = p_import and status = 'recebido'
           order by row_number limit v_chunk) x;

  if v_upto is not null then
    -- Pares (linha, CNPJ, relacionamento) do trecho. Um par é repetição se
    -- uma linha ANTERIOR do mesmo arquivo (deste ou de trecho já processado)
    -- tem o mesmo CNPJ e relacionamento; vale a primeira ocorrência. A regra
    -- não depende do tamanho do trecho.
    if to_regclass('pg_temp.tmp_pairs') is not null then drop table tmp_pairs; end if;
    create temporary table tmp_pairs on commit drop as
      select i.row_number, i.cnpj::text as cnpj, rel, i.razao_social, i.nome_fantasia,
             exists (select 1 from tax_import_items e
                      where e.import_id = p_import and e.cnpj = i.cnpj and e.row_number < i.row_number
                        and e.status in ('recebido', 'valido', 'ja_existente', 'duplicado_no_arquivo')
                        and rel = any (e.relationships)) as repeated,
             exists (select 1 from tax_relationships r
                      where r.tenant_id = v_imp.tenant_id and r.cnpj = i.cnpj and r.relationship = rel) as existed
        from tax_import_items i
        cross join lateral unnest(i.relationships) as rel
       where i.import_id = p_import and i.status = 'recebido' and i.row_number <= v_upto;
    -- Tabela temporária não recebe autovacuum: sem estatística o planejador
    -- estima 1 linha e pode escolher laço aninhado (140 s em 70 mil linhas).
    analyze tmp_pairs;

    update tax_import_items i set status = x.new_status
      from (
        select p.row_number,
               case
                 when bool_and(p.repeated) then 'duplicado_no_arquivo'
                 when bool_and(p.repeated or p.existed) then 'ja_existente'
                 else 'valido'
               end::tax_import_item_status as new_status
          from tmp_pairs p
         group by p.row_number
      ) x
     where i.import_id = p_import and i.row_number = x.row_number;

    insert into tax_entities (cnpj)
    select distinct p.cnpj from tmp_pairs p where not p.repeated
    on conflict (cnpj) do nothing;

    -- Primeira ocorrência de cada par dentro do trecho (as anteriores já
    -- foram excluídas por "repeated").
    insert into tax_relationships (tenant_id, cnpj, relationship, declared_razao_social,
                                   declared_nome_fantasia, first_import_id, last_import_id, created_by)
    select distinct on (p.cnpj, p.rel)
           v_imp.tenant_id, p.cnpj, p.rel, p.razao_social, p.nome_fantasia, p_import, p_import, auth.uid()
      from tmp_pairs p
     where not p.repeated
     order by p.cnpj, p.rel, p.row_number
    on conflict (tenant_id, cnpj, relationship) do update
      set last_import_id = excluded.last_import_id,
          declared_razao_social = coalesce(excluded.declared_razao_social, tax_relationships.declared_razao_social),
          declared_nome_fantasia = coalesce(excluded.declared_nome_fantasia, tax_relationships.declared_nome_fantasia),
          updated_at = now();

    select count(distinct (p.cnpj, p.rel)) into v_new_rel from tmp_pairs p where not p.repeated and not p.existed;
    update tax_imports set new_relationships_count = new_relationships_count + v_new_rel where id = p_import;
  end if;

  select count(*) into v_remaining from tax_import_items where import_id = p_import and status = 'recebido';
  if v_remaining > 0 then
    update tax_processing_jobs set processed = v_imp.received_rows - v_remaining, heartbeat_at = now()
     where import_id = p_import and kind = 'importacao';
    return jsonb_build_object('import_id', p_import, 'status', 'finalizando', 'done', false,
                              'remaining_rows', v_remaining, 'expected_rows', v_imp.expected_rows);
  end if;

  update tax_imports t set
    status = 'concluida',
    finalized_by = auth.uid(),
    finalized_at = now(),
    valid_count = c.valid,
    duplicate_count = c.dup,
    existing_count = c.existing,
    invalid_cnpj_count = c.inv_cnpj,
    missing_cnpj_count = c.missing,
    invalid_relationship_count = c.inv_rel,
    padded_count = c.padded,
    unique_cnpjs = c.uniq,
    unique_roots = c.roots
  from (
    select count(*) filter (where status = 'valido') as valid,
           count(*) filter (where status = 'duplicado_no_arquivo') as dup,
           count(*) filter (where status = 'ja_existente') as existing,
           count(*) filter (where status = 'cnpj_invalido') as inv_cnpj,
           count(*) filter (where status = 'cnpj_ausente') as missing,
           count(*) filter (where status = 'relacionamento_invalido') as inv_rel,
           count(*) filter (where normalization_note is not null) as padded,
           count(distinct cnpj) filter (where status in ('valido', 'duplicado_no_arquivo', 'ja_existente')) as uniq,
           count(distinct substr(cnpj, 1, 8)) filter (where status in ('valido', 'duplicado_no_arquivo', 'ja_existente')) as roots
      from tax_import_items where import_id = p_import
  ) c
  where t.id = p_import
  returning * into v_imp;

  update tax_processing_jobs set status = 'concluido', processed = v_imp.received_rows,
         succeeded = v_imp.valid_count + v_imp.existing_count + v_imp.duplicate_count,
         failed = v_imp.invalid_cnpj_count + v_imp.missing_cnpj_count + v_imp.invalid_relationship_count,
         finished_at = now(), heartbeat_at = now()
   where import_id = p_import and kind = 'importacao';

  v_summary := tax_import_summary(v_imp);
  perform tax_audit(v_imp.tenant_id, 'tax.import.finalize', 'tax_imports', p_import::text, null, v_summary);
  perform log_audit(v_imp.tenant_id, 'tax.import.finalize', 'tax_imports', p_import::text, null, v_summary);
  return v_summary || jsonb_build_object('done', true);
end $$;

create or replace function public.tax_import_summary(v tax_imports)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'import_id', v.id, 'status', v.status,
    'expected_rows', v.expected_rows, 'received_rows', v.received_rows,
    'valid', v.valid_count, 'duplicate_in_file', v.duplicate_count, 'already_existing', v.existing_count,
    'invalid_cnpj', v.invalid_cnpj_count, 'missing_cnpj', v.missing_cnpj_count,
    'invalid_relationship', v.invalid_relationship_count, 'padded', v.padded_count,
    'new_relationships', v.new_relationships_count,
    'unique_cnpjs', v.unique_cnpjs, 'unique_roots', v.unique_roots,
    'finalized_at', v.finalized_at);
$$;

-- ---------------------------------------------------------------------------
-- 4. Cancelar (as linhas recebidas ficam para auditoria)
-- ---------------------------------------------------------------------------
create or replace function public.tax_import_cancel(p_import uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_imp tax_imports;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_imp from tax_imports where id = p_import for update;
  if v_imp.id is null or not tax_can_write(v_imp.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_imp.status <> 'recebendo' then
    raise exception 'Só uma importação em andamento pode ser cancelada' using errcode = '22023';
  end if;
  update tax_imports set status = 'cancelada', canceled_by = auth.uid(), canceled_at = now()
   where id = p_import;
  update tax_processing_jobs set status = 'cancelado', finished_at = now()
   where import_id = p_import and kind = 'importacao';
  perform tax_audit(v_imp.tenant_id, 'tax.import.cancel', 'tax_imports', p_import::text,
                    jsonb_build_object('received_rows', v_imp.received_rows), null);
  perform log_audit(v_imp.tenant_id, 'tax.import.cancel', 'tax_imports', p_import::text, null, null);
  return jsonb_build_object('import_id', p_import, 'status', 'cancelada');
end $$;

revoke all on function public.tax_import_create(uuid, text, bigint, text, text, text, integer, public.tax_relationship_kind, integer)
  from public, anon;
revoke all on function public.tax_import_add_items(uuid, jsonb) from public, anon;
revoke all on function public.tax_import_finalize(uuid) from public, anon;
revoke all on function public.tax_import_cancel(uuid) from public, anon;
revoke all on function public.tax_import_summary(public.tax_imports) from public, anon, authenticated;
grant execute on function public.tax_import_create(uuid, text, bigint, text, text, text, integer, public.tax_relationship_kind, integer)
  to authenticated;
grant execute on function public.tax_import_add_items(uuid, jsonb) to authenticated;
grant execute on function public.tax_import_finalize(uuid) to authenticated;
grant execute on function public.tax_import_cancel(uuid) to authenticated;
