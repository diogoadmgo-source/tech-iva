-- 0251 · Inteligência Tributária: processar a base de CNPJs pelo app.
--
-- O botão "Processar agora" chama a Edge Function tax-intel-processar, que:
--   1. pede ao banco (com o JWT do usuário) para registrar a solicitação:
--      tax_request_processing confere permissão, recusa se já houver execução
--      em andamento ou solicitação recente, grava a solicitação e a auditoria;
--   2. aciona o workflow do motor no GitHub (segredo GITHUB_DISPATCH_TOKEN, só
--      na função);
--   3. marca a solicitação como enviada ou com falha (tax_mark_processing_request).
-- O andamento é lido por tax_processing_status, que expõe só o resumo público
-- da última execução (tax_source_runs é restrita a gestores da plataforma) e a
-- última solicitação da própria empresa.
--
-- Reversão: recriar tax_ingest_file como na 0242; drop function tax_processing_status(uuid),
--   tax_mark_processing_request(uuid, text, text), tax_request_processing(uuid);
--   drop table tax_processing_requests.

create table public.tax_processing_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  requested_by  uuid not null,
  requested_at  timestamptz not null default now(),
  status        text not null default 'solicitado'
                check (status in ('solicitado', 'enviado', 'falhou')),
  dispatched_at timestamptz,
  error         text check (error is null or length(error) <= 500)
);
create index tax_processing_requests_tenant on public.tax_processing_requests (tenant_id, requested_at desc);
create index tax_processing_requests_recent on public.tax_processing_requests (requested_at desc);

alter table public.tax_processing_requests enable row level security;
revoke all on public.tax_processing_requests from public, anon, authenticated;
grant select on public.tax_processing_requests to authenticated;
grant all on public.tax_processing_requests to service_role;
create policy tax_processing_requests_read on public.tax_processing_requests
  for select to authenticated
  using (tenant_id = any ((select public.tax_scope_tenants())::uuid[]));

-- ---------------------------------------------------------------------------
-- Solicitar processamento
-- ---------------------------------------------------------------------------
create or replace function public.tax_request_processing(p_tenant uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_run  tax_source_runs;
  v_req  tax_processing_requests;
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if not (public.tax_can_write(p_tenant) or public.tax_is_platform_manager()) then
    raise exception 'sem permissão para processar a base desta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from tax_relationships where tenant_id = p_tenant) then
    return jsonb_build_object('ok', false, 'motivo', 'base_vazia');
  end if;

  -- Serializa pedidos simultâneos (dois cliques, duas abas, duas empresas).
  perform pg_advisory_xact_lock(hashtext('tax_request_processing'));

  select * into v_run from tax_source_runs
   where not dry_run and status = 'iniciada' and started_at > now() - interval '6 hours'
   order by started_at desc limit 1;
  if found then
    return jsonb_build_object('ok', false, 'motivo', 'em_andamento', 'run_id', v_run.id,
                              'desde', v_run.started_at);
  end if;

  -- O motor processa todas as bases de uma vez: um pedido enviado nos últimos
  -- 15 minutos (de qualquer empresa) ainda vai começar.
  select * into v_req from tax_processing_requests
   where status in ('solicitado', 'enviado') and requested_at > now() - interval '15 minutes'
   order by requested_at desc limit 1;
  if found then
    return jsonb_build_object('ok', false, 'motivo', 'ja_solicitado', 'desde', v_req.requested_at);
  end if;

  insert into tax_processing_requests (tenant_id, requested_by)
  values (p_tenant, auth.uid()) returning id into v_id;
  perform public.tax_audit(p_tenant, 'tax.processing.request', 'tax_processing_request', v_id::text);
  return jsonb_build_object('ok', true, 'request_id', v_id);
end $$;

-- A função marca o resultado do disparo. Só quem pediu, nos primeiros 10 min.
create or replace function public.tax_mark_processing_request(p_request uuid, p_status text, p_error text default null)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v tax_processing_requests;
begin
  if p_status not in ('enviado', 'falhou') then
    raise exception 'status inválido' using errcode = '22023';
  end if;
  select * into v from tax_processing_requests where id = p_request for update;
  if not found or v.requested_by is distinct from auth.uid() or v.status <> 'solicitado'
     or v.requested_at < now() - interval '10 minutes' then
    raise exception 'solicitação não encontrada' using errcode = '42501';
  end if;
  update tax_processing_requests
     set status = p_status,
         dispatched_at = case when p_status = 'enviado' then now() end,
         error = left(p_error, 500)
   where id = p_request;
  perform public.tax_audit(v.tenant_id,
    case when p_status = 'enviado' then 'tax.processing.dispatch' else 'tax.processing.fail' end,
    'tax_processing_request', p_request::text, null,
    case when p_error is null then null else jsonb_build_object('erro', left(p_error, 500)) end);
end $$;

-- ---------------------------------------------------------------------------
-- Andamento (resumo público da última execução + pedido da empresa)
-- ---------------------------------------------------------------------------
create or replace function public.tax_processing_status(p_tenant uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_run  tax_source_runs;
  v_req  tax_processing_requests;
  v_files jsonb;
begin
  if not (p_tenant = any (public.tax_scope_tenants()::uuid[]) or public.tax_is_platform_manager()) then
    raise exception 'sem acesso a esta empresa' using errcode = '42501';
  end if;

  select * into v_run from tax_source_runs where not dry_run order by started_at desc limit 1;
  if v_run.id is not null then
    select jsonb_build_object(
             'total', count(*),
             'concluidos', count(*) filter (where status = 'concluido'),
             'linhas', coalesce(sum(rows_scanned), 0),
             'atual', (select f2.file_name from tax_source_run_files f2
                        where f2.run_id = v_run.id and f2.status in ('baixando', 'processando')
                        order by f2.updated_at desc limit 1))
      into v_files
      from tax_source_run_files where run_id = v_run.id;
  end if;

  select * into v_req from tax_processing_requests
   where tenant_id = p_tenant order by requested_at desc limit 1;

  return jsonb_build_object(
    'execucao', case when v_run.id is null then null else jsonb_build_object(
        'id', v_run.id,
        'status', v_run.status,
        'competencia', v_run.competencia,
        'datasets', v_run.datasets,
        'iniciada_em', v_run.started_at,
        'concluida_em', v_run.finished_at,
        'cnpjs_alvo', v_run.targets_count,
        'erro', case when v_run.error is null then null else left(v_run.error, 300) end,
        'arquivos', v_files) end,
    'solicitacao', case when v_req.id is null then null else jsonb_build_object(
        'id', v_req.id,
        'status', v_req.status,
        'solicitada_em', v_req.requested_at,
        'enviada_em', v_req.dispatched_at,
        'erro', v_req.error) end,
    'pode_processar', public.tax_can_write(p_tenant) or public.tax_is_platform_manager());
end $$;

revoke all on function public.tax_request_processing(uuid) from public, anon;
revoke all on function public.tax_mark_processing_request(uuid, text, text) from public, anon;
revoke all on function public.tax_processing_status(uuid) from public, anon;
grant execute on function public.tax_request_processing(uuid) to authenticated;
grant execute on function public.tax_mark_processing_request(uuid, text, text) to authenticated;
grant execute on function public.tax_processing_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Andamento real: o executor registra todos os arquivos como "pendente" antes
-- de começar. Um "pendente" nunca rebaixa um arquivo que já avançou (retomada).
-- ---------------------------------------------------------------------------
create or replace function public.tax_ingest_file(
  p_run uuid, p_file_name text, p_size bigint, p_sha256 text, p_header text[],
  p_rows_scanned bigint, p_rows_matched bigint, p_last_row bigint, p_status text)
returns bigint
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_last bigint;
begin
  perform tax_ingest_guard(p_run);
  insert into tax_source_run_files (run_id, file_name, size_bytes, sha256, header, rows_scanned,
                                    rows_matched, last_row_committed, status, updated_at)
  values (p_run, p_file_name, p_size, p_sha256, p_header, coalesce(p_rows_scanned, 0),
          coalesce(p_rows_matched, 0), coalesce(p_last_row, 0), p_status, now())
  on conflict (run_id, file_name) do update set
    size_bytes = coalesce(excluded.size_bytes, tax_source_run_files.size_bytes),
    sha256 = coalesce(excluded.sha256, tax_source_run_files.sha256),
    header = coalesce(excluded.header, tax_source_run_files.header),
    rows_scanned = greatest(excluded.rows_scanned, tax_source_run_files.rows_scanned),
    rows_matched = greatest(excluded.rows_matched, tax_source_run_files.rows_matched),
    last_row_committed = greatest(excluded.last_row_committed, tax_source_run_files.last_row_committed),
    status = case when excluded.status = 'pendente' then tax_source_run_files.status
                  else excluded.status end,
    updated_at = now()
  returning last_row_committed into v_last;
  return v_last;
end $$;
revoke all on function public.tax_ingest_file(uuid, text, bigint, text, text[], bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.tax_ingest_file(uuid, text, bigint, text, text[], bigint, bigint, bigint, text) to tax_ingestor;
