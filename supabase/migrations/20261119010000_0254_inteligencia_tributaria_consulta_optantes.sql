-- 0254 · Inteligência Tributária · Consulta Optantes assistida (IBS/CBS)
--
-- A opção do Simples pelo regime regular de IBS/CBS só aparece na Consulta
-- Optantes do Portal do Simples, um CNPJ por vez e protegida por hCaptcha
-- (sonda de 19/11/2026: robô é bloqueado). Por isso a consulta é feita por uma
-- pessoa; o app lê o texto do resultado que ela cola e grava aqui.
--
-- Grava duas evidências (IBS e CBS são fatos separados) em tax_evidences, por
-- raiz (a opção abrange todos os estabelecimentos), origem
-- portal_simples_nacional, com o usuário responsável e a data da consulta.
-- A consulta anterior da mesma raiz passa a "substituida" (histórico mantido).
-- Só para CNPJ que a base do tenant tem e que a Receita aponta como optante do
-- Simples: fora do Simples a pergunta não se aplica.

create or replace function public.tax_register_consulta_optantes(
  p_tenant        uuid,
  p_cnpj          text,
  p_ibs           text,
  p_ibs_desde     date,
  p_cbs           text,
  p_cbs_desde     date,
  p_consultado_em timestamptz,
  p_file_path     text default null,
  p_file_sha256   text default null,
  p_file_mime     text default null,
  p_file_size     bigint default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_cnpj  text := tax_cnpj_strip(p_cnpj);
  v_raiz  text;
  v_class tax_classification;
  v_dia   date := (p_consultado_em at time zone 'America/Sao_Paulo')::date;
  v_desc  text;
  v_ids   jsonb := '{}'::jsonb;
  v_fact  tax_evidence_fact;
  v_val   text;
  v_desde date;
  v_old   uuid;
  v_new   uuid;
begin
  if v_user is null or not tax_can_write(p_tenant) then
    raise exception 'sem permissão para registrar evidência neste tenant' using errcode = '42501';
  end if;
  if v_cnpj is null or not tax_cnpj_is_valid(v_cnpj) then
    raise exception 'CNPJ inválido' using errcode = '22023';
  end if;
  if p_ibs not in ('sim', 'nao') or p_cbs not in ('sim', 'nao') then
    raise exception 'resultado deve ser sim ou nao' using errcode = '22023';
  end if;
  if p_consultado_em is null or p_consultado_em > now() + interval '1 day'
     or p_consultado_em < now() - interval '400 days' then
    raise exception 'data da consulta fora do intervalo aceito' using errcode = '22023';
  end if;

  select e.cnpj_raiz, e.public_classification into v_raiz, v_class
    from tax_relationships r join tax_entities e on e.cnpj = r.cnpj
   where r.tenant_id = p_tenant and r.cnpj = v_cnpj
   limit 1;
  if v_raiz is null then
    raise exception 'CNPJ não está na base deste tenant' using errcode = '22023';
  end if;
  if v_class is distinct from 'simples_nacional' then
    raise exception 'a opção IBS/CBS só se aplica a optante do Simples Nacional' using errcode = '22023';
  end if;

  v_desc := format('Consulta Optantes (Portal do Simples Nacional) feita em %s para o CNPJ %s',
                   to_char(p_consultado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), v_cnpj);

  foreach v_fact in array array['ibs_regular', 'cbs_regular']::tax_evidence_fact[] loop
    v_val   := case when v_fact = 'ibs_regular' then p_ibs else p_cbs end;
    v_desde := case when v_fact = 'ibs_regular' then p_ibs_desde else p_cbs_desde end;

    select id into v_old from tax_evidences
     where tenant_id = p_tenant and lookup_key = v_raiz and granularity = 'raiz'
       and fact = v_fact and origin = 'portal_simples_nacional' and status = 'ativa'
     order by created_at desc limit 1;
    if v_old is not null then
      update tax_evidences set status = 'substituida', revoked_by = v_user, revoked_at = now(),
             revoke_reason = 'nova Consulta Optantes'
       where tenant_id = p_tenant and lookup_key = v_raiz and granularity = 'raiz'
         and fact = v_fact and origin = 'portal_simples_nacional' and status = 'ativa';
    end if;

    insert into tax_evidences (tenant_id, fact, asserted_value, lookup_key, granularity, origin,
      origin_description, document_date, responsible_user, valid_from, file_path, file_sha256,
      file_mime, file_size_bytes, supersedes_id)
    values (p_tenant, v_fact, v_val::tax_tri_state, v_raiz, 'raiz', 'portal_simples_nacional',
      v_desc, v_dia, v_user,
      case when v_val = 'sim' and v_desde is not null then v_desde else v_dia end,
      p_file_path, p_file_sha256, p_file_mime, p_file_size, v_old)
    returning id into v_new;
    v_ids := v_ids || jsonb_build_object(v_fact::text, v_new);
  end loop;

  perform tax_audit(p_tenant, 'tax.evidencia.consulta_optantes', 'tax_evidences', v_raiz, null,
    jsonb_build_object('cnpj', v_cnpj, 'ibs', p_ibs, 'cbs', p_cbs, 'consultado_em', p_consultado_em,
                       'arquivo', p_file_path is not null));
  return v_ids || jsonb_build_object('raiz', v_raiz);
end $$;

revoke all on function public.tax_register_consulta_optantes(uuid, text, text, date, text, date, timestamptz, text, text, text, bigint) from public, anon;
grant execute on function public.tax_register_consulta_optantes(uuid, text, text, date, text, date, timestamptz, text, text, text, bigint) to authenticated;

update public.tax_sources
   set limitations = 'Não há fonte pública em lote. A Consulta Optantes do Portal do Simples mostra a opção, um CNPJ por vez, sem lote, API ou dados abertos; protegida por hCaptcha (robô é bloqueado). Só consulta feita por pessoa, registrada como evidência do tenant (0254).'
 where code = 'ibs_cbs_regular';

-- Optantes do Simples para o motor (tax_ingestor): uma linha por empresa
-- (raiz), de preferência a matriz, em páginas por raiz. Serve à consulta da
-- opção IBS/CBS por provedor (teste da CNPJá) sem dar SELECT direto nas tabelas.
create or replace function public.tax_ingest_simples_targets(p_after text default null, p_limit int default 1000)
returns table (cnpj text, cnpj_raiz text)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select distinct on (e.cnpj_raiz) e.cnpj::text, e.cnpj_raiz::text
    from tax_entities e
   where e.public_classification = 'simples_nacional'
     and (p_after is null or e.cnpj_raiz > p_after)
     and exists (select 1 from tax_relationships r where r.cnpj = e.cnpj)
   order by e.cnpj_raiz, e.is_matriz desc, e.cnpj
   limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;
revoke all on function public.tax_ingest_simples_targets(text, int) from public, anon, authenticated;
grant execute on function public.tax_ingest_simples_targets(text, int) to tax_ingestor;
