-- 0255 · Inteligência Tributária · Opção IBS/CBS dos optantes do Simples pela CNPJá
--
-- A Receita só mostra a opção pelo regime regular de IBS e de CBS na Consulta
-- Optantes (um CNPJ por vez, com captcha). A CNPJá (API paga, autorizada pelo
-- usuário em 19/11/2026) devolve esse dado: company.simples.events =
-- [{regime: "IBS"|"CBS", from: "AAAA-MM-DD", text}]. Evento presente = optante
-- desde "from"; sem evento = não optante (a conferir por consulta assistida).
--
-- Fato público, por raiz (a opção abrange todos os estabelecimentos): cada
-- resposta vira uma consulta imutável em tax_consultations e o estado atual
-- fica em tax_entities. Grava só o papel tax_ingestor (nunca service_role).

insert into public.tax_sources (code, name, kind, url, granularity, coverage, limitations, status, verified_at, verified_note)
values ('cnpja_simples', 'CNPJá — Simples Nacional e opção pelo regime regular de IBS/CBS',
  'api', 'https://api.cnpja.com/', 'raiz',
  'Optantes do Simples da base: opção pelo regime regular de IBS e de CBS, com data de início.',
  'API paga (créditos por consulta). Fonte original: Consulta Optantes do Portal do Simples. Sem evento = não optante, a conferir por consulta assistida.',
  'ativa', now(), 'Teste de 19/11/2026: 10 consultas, 3 com opção pelo regime regular desde 2027-01-01.')
on conflict (code) do nothing;

alter table public.tax_entities
  add column if not exists ibs_regular           public.tax_tri_state not null default 'nao_identificado',
  add column if not exists ibs_desde             date,
  add column if not exists cbs_regular           public.tax_tri_state not null default 'nao_identificado',
  add column if not exists cbs_desde             date,
  add column if not exists ibs_cbs_fonte         text check (ibs_cbs_fonte is null or ibs_cbs_fonte ~ '^[a-z][a-z0-9_]{2,40}$'),
  add column if not exists ibs_cbs_consultado_em timestamptz;

-- Alvos: optantes do Simples sem consulta da opção, ou com consulta mais velha
-- que p_idade_dias. Uma linha por raiz, matriz primeiro.
create or replace function public.tax_ingest_ibs_cbs_targets(
  p_after text default null, p_limit int default 1000, p_idade_dias int default 30)
returns table (cnpj text, cnpj_raiz text)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select distinct on (e.cnpj_raiz) e.cnpj::text, e.cnpj_raiz::text
    from tax_entities e
   where e.public_classification = 'simples_nacional'
     and (p_after is null or e.cnpj_raiz > p_after)
     and exists (select 1 from tax_relationships r where r.cnpj = e.cnpj)
     and not exists (select 1 from tax_entities x
                      where x.cnpj_raiz = e.cnpj_raiz and x.ibs_cbs_fonte = 'cnpja_simples'
                        and x.ibs_cbs_consultado_em > now() - make_interval(days => greatest(coalesce(p_idade_dias, 30), 0)))
   order by e.cnpj_raiz, e.is_matriz desc, e.cnpj
   limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

-- Grava um lote de respostas. Linha:
--   {raiz, status: ok|nao_encontrado|erro, http, erro?,
--    ibs: sim|nao, ibs_desde?, cbs: sim|nao, cbs_desde?, raw: company.simples}
create or replace function public.tax_ingest_ibs_cbs(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r jsonb; v_ok int := 0; v_err int := 0; v_ent int := 0; n int;
  v_raiz text; v_status tax_consultation_status; v_raw jsonb; v_norm jsonb;
begin
  if session_user <> 'tax_ingestor' then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'lote inválido (array de até 500 linhas)' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_raiz := r->>'raiz';
    if v_raiz is null or v_raiz !~ '^[0-9A-Z]{8}$' then
      raise exception 'raiz inválida' using errcode = '22023';
    end if;
    v_status := (r->>'status')::tax_consultation_status;
    v_raw := r->'raw';
    if v_status = 'ok' and (r->>'ibs' not in ('sim', 'nao') or r->>'cbs' not in ('sim', 'nao')) then
      raise exception 'ibs/cbs devem ser sim ou nao' using errcode = '22023';
    end if;
    v_norm := case when v_status = 'ok' then jsonb_build_object(
      'ibs', r->>'ibs', 'ibs_desde', r->>'ibs_desde', 'cbs', r->>'cbs', 'cbs_desde', r->>'cbs_desde') end;
    insert into tax_consultations (source_code, dataset_version, lookup_key, granularity, status, http_status,
                                   response_raw, response_normalized, response_sha256, error)
    values ('cnpja_simples', null, v_raiz, 'raiz', v_status, nullif(r->>'http', '')::int,
            v_raw, v_norm,
            case when v_raw is not null then encode(digest(v_raw::text, 'sha256'), 'hex') end,
            left(r->>'erro', 2000));
    if v_status = 'ok' then
      update tax_entities e
         set ibs_regular = (r->>'ibs')::tax_tri_state,
             ibs_desde = case when r->>'ibs' = 'sim' then nullif(r->>'ibs_desde', '')::date end,
             cbs_regular = (r->>'cbs')::tax_tri_state,
             cbs_desde = case when r->>'cbs' = 'sim' then nullif(r->>'cbs_desde', '')::date end,
             ibs_cbs_fonte = 'cnpja_simples',
             ibs_cbs_consultado_em = now(),
             updated_at = now()
       where e.cnpj_raiz = v_raiz;
      get diagnostics n = row_count;
      v_ent := v_ent + n;
      v_ok := v_ok + 1;
    else
      v_err := v_err + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'erros', v_err, 'cnpjs_atualizados', v_ent);
end $$;

revoke all on function public.tax_ingest_ibs_cbs_targets(text, int, int) from public, anon, authenticated;
revoke all on function public.tax_ingest_ibs_cbs(jsonb) from public, anon, authenticated;
grant execute on function public.tax_ingest_ibs_cbs_targets(text, int, int) to tax_ingestor;
grant execute on function public.tax_ingest_ibs_cbs(jsonb) to tax_ingestor;
