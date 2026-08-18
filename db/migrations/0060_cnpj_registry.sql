-- 0060_cnpj_registry.sql
-- ESPELHO da migration já aplicada no banco pela equipe (não reaplicar em produção).
-- Cache GLOBAL de dados públicos da Receita: sem tenant_id de propósito — o mesmo CNPJ
-- aparece na cadeia de dezenas de clientes; cachear por tenant multiplicaria as consultas
-- externas por N. Leitura para qualquer authenticated (dado público), escrita só service_role.

create table if not exists public.cnpj_registry (
  cnpj                  text primary key,
  razao_social          text,
  nome_fantasia         text,
  situacao              text,
  situacao_data         date,
  abertura              date,
  natureza_juridica     text,
  porte                 text,
  capital_social_cents  bigint,
  cnae_principal        text,
  cnae_principal_desc   text,
  cnae_secundarios      jsonb not null default '[]'::jsonb,
  uf                    text,
  municipio             text,
  bairro                text,
  logradouro            text,
  numero                text,
  complemento           text,
  cep                   text,
  email                 text,
  telefone              text,
  simples_optante       boolean,
  simples_desde         date,
  simples_ate           date,
  mei_optante           boolean,
  mei_desde             date,
  matriz                boolean,
  source                text not null default 'publica',
  fetched_at            timestamptz not null default now(),
  raw                   jsonb
);

grant select on public.cnpj_registry to authenticated;
grant all    on public.cnpj_registry to service_role;

alter table public.cnpj_registry enable row level security;

drop policy if exists cnpj_registry_select on public.cnpj_registry;
create policy cnpj_registry_select on public.cnpj_registry
  for select to authenticated using (true);
-- Nenhuma política de escrita: só service_role (que ignora RLS) grava.

-- ---------------------------------------------------------------------------
-- Classificação de regime a partir do cadastro público.
-- MEI -> 'mei'; optante do Simples -> 'simples'; NÃO optante -> 'presumido'
-- (padrão conservador: o cadastro público NÃO distingue presumido de real;
--  o usuário corrige com set_regime_manual).
-- ---------------------------------------------------------------------------
create or replace function public.regime_from_registry(
  p_simples boolean, p_mei boolean, p_natureza text
) returns regime_kind
language sql immutable set search_path to 'public','extensions' as $$
  select case
    when p_mei then 'mei'::regime_kind
    when p_simples then 'simples'::regime_kind
    when p_simples = false then 'presumido'::regime_kind
    else 'desconhecido'::regime_kind
  end;
$$;

create or replace function public.credit_pct_from_regime(p_regime regime_kind)
returns numeric
language sql immutable set search_path to 'public','extensions' as $$
  select case p_regime
    when 'real' then 100 when 'presumido' then 100 when 'simples_hibrido' then 100
    when 'simples' then 28      -- crédito reduzido; parametrizável quando a regra fechar
    when 'mei' then 0 when 'pf' then 0 when 'imune' then 0
    else null end::numeric;
$$;

-- Consulta ao cache. TTL de 30 dias marca stale=true.
create or replace function public.cnpj_lookup(p_cnpj text)
returns jsonb
language plpgsql stable security definer
set search_path to 'public','extensions' as $$
declare v cnpj_registry; v_digits text := regexp_replace(coalesce(p_cnpj,''), '\D', '', 'g');
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if length(v_digits) <> 14 then raise exception 'CNPJ invalido'; end if;

  select * into v from cnpj_registry where cnpj = v_digits;
  if v.cnpj is null then
    return jsonb_build_object('found', false, 'cnpj', v_digits, 'stale', true);
  end if;

  return jsonb_build_object(
    'found', true,
    'stale', v.fetched_at < now() - interval '30 days',
    'cnpj', v.cnpj,
    'razao_social', v.razao_social, 'nome_fantasia', v.nome_fantasia,
    'situacao', v.situacao, 'abertura', v.abertura, 'porte', v.porte,
    'natureza_juridica', v.natureza_juridica,
    'cnae_principal', v.cnae_principal, 'cnae_principal_desc', v.cnae_principal_desc,
    'uf', v.uf, 'municipio', v.municipio, 'bairro', v.bairro,
    'logradouro', v.logradouro, 'numero', v.numero, 'complemento', v.complemento, 'cep', v.cep,
    'email', v.email, 'telefone', v.telefone, 'matriz', v.matriz,
    'simples_optante', v.simples_optante, 'mei_optante', v.mei_optante,
    'regime', regime_from_registry(v.simples_optante, v.mei_optante, v.natureza_juridica),
    'credit_transfer_pct', credit_pct_from_regime(regime_from_registry(v.simples_optante, v.mei_optante, v.natureza_juridica)),
    'fetched_at', v.fetched_at
  );
end $$;

-- Gravação do cache: SÓ service_role (server function cnpj-fetch).
create or replace function public.cnpj_registry_upsert(p jsonb)
returns void
language plpgsql security definer
set search_path to 'public','extensions' as $$
declare v_digits text := regexp_replace(coalesce(p->>'cnpj',''), '\D', '', 'g');
begin
  if length(v_digits) <> 14 then raise exception 'CNPJ invalido'; end if;
  insert into cnpj_registry (
    cnpj, razao_social, nome_fantasia, situacao, situacao_data, abertura, natureza_juridica,
    porte, capital_social_cents, cnae_principal, cnae_principal_desc, cnae_secundarios,
    uf, municipio, bairro, logradouro, numero, complemento, cep, email, telefone,
    simples_optante, simples_desde, simples_ate, mei_optante, mei_desde, matriz,
    source, fetched_at, raw)
  values (
    v_digits, p->>'razao_social', p->>'nome_fantasia', p->>'situacao',
    (p->>'situacao_data')::date, (p->>'abertura')::date, p->>'natureza_juridica',
    p->>'porte', (p->>'capital_social_cents')::bigint,
    p->>'cnae_principal', p->>'cnae_principal_desc', coalesce(p->'cnae_secundarios','[]'::jsonb),
    p->>'uf', p->>'municipio', p->>'bairro', p->>'logradouro', p->>'numero',
    p->>'complemento', p->>'cep', p->>'email', p->>'telefone',
    (p->>'simples_optante')::boolean, (p->>'simples_desde')::date, (p->>'simples_ate')::date,
    (p->>'mei_optante')::boolean, (p->>'mei_desde')::date, (p->>'matriz')::boolean,
    coalesce(p->>'source','publica'), now(), p->'raw')
  on conflict (cnpj) do update set
    razao_social=excluded.razao_social, nome_fantasia=excluded.nome_fantasia,
    situacao=excluded.situacao, situacao_data=excluded.situacao_data, abertura=excluded.abertura,
    natureza_juridica=excluded.natureza_juridica, porte=excluded.porte,
    capital_social_cents=excluded.capital_social_cents,
    cnae_principal=excluded.cnae_principal, cnae_principal_desc=excluded.cnae_principal_desc,
    cnae_secundarios=excluded.cnae_secundarios, uf=excluded.uf, municipio=excluded.municipio,
    bairro=excluded.bairro, logradouro=excluded.logradouro, numero=excluded.numero,
    complemento=excluded.complemento, cep=excluded.cep, email=excluded.email, telefone=excluded.telefone,
    simples_optante=excluded.simples_optante, simples_desde=excluded.simples_desde,
    simples_ate=excluded.simples_ate, mei_optante=excluded.mei_optante, mei_desde=excluded.mei_desde,
    matriz=excluded.matriz, source=excluded.source, fetched_at=now(), raw=excluded.raw;
end $$;

revoke all on function public.cnpj_registry_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.cnpj_registry_upsert(jsonb) to service_role;
grant execute on function public.cnpj_lookup(text) to authenticated;
