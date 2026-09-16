-- AUDITORIA DE MÉRITO DA NOTA FISCAL (F1)
-- A SEFAZ valida sintaxe; a Receita cobra mérito. Recalculamos cada item no motor oficial
-- (Calculadora RFB) e apontamos onde a nota AUTORIZADA está errada.
--   A1 ausencia_grupo · A2 par_invalido · A3 classificacao_indevida
--   A4 valor_divergente · A5 beneficio_nao_usado · A6 credito_em_risco

do $$ begin
  create type audit_finding_class as enum
    ('ausencia_grupo','par_invalido','classificacao_indevida','valor_divergente','beneficio_nao_usado','credito_em_risco');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_finding_status as enum ('aberto','aceito','ignorado','corrigido');
exception when duplicate_object then null; end $$;

create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_item_id uuid not null references invoice_items(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  classe audit_finding_class not null,
  severidade alert_severity not null default 'warning',
  cst text, cclasstrib text, classificacao text, uf text, competencia date,
  valor_risco_cents bigint not null default 0,
  esperado jsonb,
  encontrado jsonb,
  memoria jsonb,
  rule_version text not null,
  status audit_finding_status not null default 'aberto',
  resolvido_por uuid, resolvido_em timestamptz,
  created_at timestamptz not null default now(),
  unique (invoice_item_id, classe, rule_version)
);
create index if not exists audit_findings_tenant_idx on public.audit_findings (tenant_id, status, classe);
create index if not exists audit_findings_assinatura_idx on public.audit_findings (tenant_id, cst, cclasstrib, classificacao, competencia);
comment on table public.audit_findings is 'Achados da auditoria de mérito. Todo achado carrega valor em risco, esperado x encontrado, memória oficial e rule_version — sem os quatro, não é exibido.';

alter table public.audit_findings enable row level security;
do $$ begin
  create policy audit_findings_read on public.audit_findings for select using (in_scope(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy audit_findings_update on public.audit_findings for update using (can_admin(tenant_id));
exception when duplicate_object then null; end $$;

create table if not exists public.calc_classtrib_aplicavel (
  rule_version text not null,
  cclasstrib text not null,
  tipo text not null check (tipo in ('ncm','nbs')),
  codigo text not null,
  ano integer not null,
  valido boolean not null,
  checked_at timestamptz not null default now(),
  primary key (rule_version, cclasstrib, tipo, codigo, ano)
);
comment on table public.calc_classtrib_aplicavel is 'Resposta do endpoint /classificacoes-tributarias/{ncm,nbs}-aplicavel do motor oficial, por versão da regra.';

create table if not exists public.calc_classtrib_matriz (
  rule_version text not null,
  cclasstrib text not null,
  cst text,
  descricao text,
  tipo_aliquota text,
  possui_reducao boolean,
  pct_reducao_cbs numeric,
  pct_reducao_ibs_uf numeric,
  pct_reducao_ibs_mun numeric,
  credito_adquirente_cbs boolean,
  credito_adquirente_ibs boolean,
  tipos_dfe jsonb,
  bruto jsonb,
  primary key (rule_version, cclasstrib)
);
comment on table public.calc_classtrib_matriz is 'Matriz CST x cClassTrib com reduções e indicadores de crédito, espelhada dos dados abertos do motor oficial.';

grant select on public.calc_classtrib_matriz, public.calc_classtrib_aplicavel to authenticated;

create or replace view public.v_audit_resumo as
select f.tenant_id, f.classe, f.severidade, f.cst, f.cclasstrib, f.classificacao,
       date_trunc('month', f.competencia)::date competencia,
       count(*) itens,
       sum(f.valor_risco_cents) valor_risco_cents,
       min(f.created_at) primeiro_achado,
       (array_agg(f.esperado order by f.created_at))[1] esperado_exemplo,
       (array_agg(f.encontrado order by f.created_at))[1] encontrado_exemplo,
       (array_agg(f.id order by f.created_at))[1] exemplo_id,
       f.rule_version
from audit_findings f
where f.status = 'aberto'
group by f.tenant_id, f.classe, f.severidade, f.cst, f.cclasstrib, f.classificacao,
         date_trunc('month', f.competencia), f.rule_version;

create or replace function public.audit_overview(p_tenant uuid, p_desde date default null)
returns jsonb language sql stable security definer set search_path to 'public','extensions' as $$
  with base as (
    select count(*) itens_auditados
    from invoice_items it join invoices i on i.id = it.invoice_id
    where it.tenant_id = p_tenant
      and i.issued_at >= coalesce(p_desde, premissa_inicio_vigencia())
  ), ach as (
    select count(*) achados, count(distinct invoice_item_id) itens_com_achado,
           coalesce(sum(valor_risco_cents),0) risco
    from audit_findings where tenant_id = p_tenant and status = 'aberto'
  )
  select jsonb_build_object(
    'itens_auditados', base.itens_auditados,
    'itens_com_achado', ach.itens_com_achado,
    'achados', ach.achados,
    'conformidade_pct', case when base.itens_auditados = 0 then null
      else round(100.0 * (base.itens_auditados - ach.itens_com_achado) / base.itens_auditados, 1) end,
    'valor_risco_cents', ach.risco,
    'rule_version', (select calc_version from rule_versions where is_current limit 1)
  ) from base, ach;
$$;
grant execute on function public.audit_overview(uuid, date) to authenticated;
