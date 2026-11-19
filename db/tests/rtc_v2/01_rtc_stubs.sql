-- Objetos da apuração (v1) que a 0260 altera ou usa, só com as colunas
-- necessárias. Colunas lidas do fluxa-dev em 19/11/2026. SÓ PARA TESTE.
set search_path = public, extensions;

create or replace function public.is_platform() returns boolean language sql stable as $$
  select exists (select 1 from memberships m join tenants t on t.id = m.tenant_id
                  where m.user_id = auth.uid() and t.kind = 'platform')
$$;

create table rtc_api_quota (
  cnpj8 text not null, dia date not null, solicitacoes int not null default 0,
  downloads int not null default 0, ultimo_erro text, primary key (cnpj8, dia));

-- cópia da definição em produção (0226/0228), usada pela v1
create or replace function public.rtc_quota_take(p_cnpj text, p_kind text, p_origem text default 'manual', p_limite integer default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $f$
declare v_c8 text := left(regexp_replace(coalesce(p_cnpj,''),'\D','','g'), 8); v_lim int := coalesce(p_limite, 2); v_atual int;
begin
  insert into rtc_api_quota (cnpj8, dia) values (v_c8, current_date) on conflict do nothing;
  select solicitacoes into v_atual from rtc_api_quota where cnpj8 = v_c8 and dia = current_date for update;
  if v_atual >= v_lim then return jsonb_build_object('permitido', false, 'motivo', 'cota v1'); end if;
  update rtc_api_quota set solicitacoes = solicitacoes + 1 where cnpj8 = v_c8 and dia = current_date;
  return jsonb_build_object('permitido', true, 'usado', v_atual + 1, 'limite', v_lim);
end $f$;

create table rtc_apuracao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  competencia date not null,
  status text not null default 'solicitada',
  webhook_ref text,
  payload jsonb,
  solicitado_em timestamptz not null default now(),
  recebido_em timestamptz,
  erro text,
  tiquete_solicitacao text,
  tiquete_download text,
  webhook_recebido_em timestamptz,
  download_em timestamptz,
  webhook_payload jsonb,
  url_assinada text,
  url_assinada_expira_em timestamptz,
  recurso text not null default 'debitos'
    constraint rtc_apuracao_recurso_ck check (recurso in ('debitos','creditos','pagamentos','recolhimentos')),
  api_versao smallint not null default 1,
  tea_segundos int
);

create table rtc_webhook_recebido (
  id bigserial primary key, ref text, payload jsonb, aceito boolean not null default false,
  meta jsonb, erro text, apuracao_id uuid, recebido_em timestamptz not null default now());
