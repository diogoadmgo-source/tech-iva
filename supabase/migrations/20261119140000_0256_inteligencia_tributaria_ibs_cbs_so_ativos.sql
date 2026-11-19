-- 0256 · Inteligência Tributária · Opção IBS/CBS: só consulta empresa ativa
--
-- A consulta da CNPJá é paga. Empresa baixada, inapta, suspensa ou nula na
-- Receita não precisa da opção pelo regime regular de IBS/CBS, então não entra
-- nos alvos. Por raiz: basta um estabelecimento ativo (de preferência a matriz).
-- Situação ainda desconhecida (nula) continua entrando.

create or replace function public.tax_ingest_ibs_cbs_targets(
  p_after text default null, p_limit int default 1000, p_idade_dias int default 30)
returns table (cnpj text, cnpj_raiz text)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select distinct on (e.cnpj_raiz) e.cnpj::text, e.cnpj_raiz::text
    from tax_entities e
   where e.public_classification = 'simples_nacional'
     and coalesce(e.situacao_cadastral, 'ATIVA') = 'ATIVA'
     and (p_after is null or e.cnpj_raiz > p_after)
     and exists (select 1 from tax_relationships r where r.cnpj = e.cnpj)
     and not exists (select 1 from tax_entities x
                      where x.cnpj_raiz = e.cnpj_raiz and x.ibs_cbs_fonte = 'cnpja_simples'
                        and x.ibs_cbs_consultado_em > now() - make_interval(days => greatest(coalesce(p_idade_dias, 30), 0)))
   order by e.cnpj_raiz, e.is_matriz desc, e.cnpj
   limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.tax_ingest_ibs_cbs_targets(text, int, int) from public, anon, authenticated;
grant execute on function public.tax_ingest_ibs_cbs_targets(text, int, int) to tax_ingestor;
