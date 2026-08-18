-- 0091 — Dois caminhos de credencial da apuração + identidade da plataforma + avisos editáveis.
-- ESPELHO: já aplicada no banco pelo Diogo. Não reaplicar.

-- ------------------------------------------------------------ avisos editáveis
create table if not exists public.platform_notices (
  key        text primary key,
  scope      text not null,
  severity   text not null default 'info',
  title      text not null,
  body       text not null,
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

grant select on public.platform_notices to authenticated;
grant insert, update, delete on public.platform_notices to authenticated;
grant all on public.platform_notices to service_role;

alter table public.platform_notices enable row level security;

create policy notices_select on public.platform_notices
  for select to authenticated using (active or is_platform());

create policy notices_write on public.platform_notices
  for all to authenticated using (is_platform()) with check (is_platform());

create or replace function public.notices_for(p_scope text)
returns table(key text, severity text, title text, body text)
language sql stable security definer set search_path = public, extensions as $$
  select n.key, n.severity, n.title, n.body
  from platform_notices n
  where n.active and n.scope = p_scope
  order by case n.severity when 'warning' then 0 else 1 end, n.key;
$$;

-- --------------------------------------------------- estado da credencial RTC
create or replace function public.rtc_credential_state(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v integration_credentials;
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  select * into v from integration_credentials
   where tenant_id = p_tenant and provider = 'rtc_cbs' and status <> 'revogada'
   order by created_at desc limit 1;

  if v.id is null then
    return jsonb_build_object('configurada', false, 'caminho', null,
      'mensagem', 'Escolha como conectar sua apuração da Receita: gerar a credencial você mesmo ou nos autorizar como procurador.');
  end if;

  return jsonb_build_object('configurada', v.status = 'ativa', 'status', v.status,
    'caminho', case v.kind when 'api_key' then 'proprio' when 'procuracao' then 'procurador' else v.kind::text end,
    'desde', v.created_at, 'ultimo_uso', v.last_used_at, 'ultimo_erro', v.last_error,
    'credential_id', v.id);
end $$;

-- ------------------------------------------------- identidade da plataforma
create or replace function public.platform_identity()
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  select coalesce(t.settings->'identity', '{}'::jsonb) into v
    from tenants t where t.kind = 'platform' limit 1;
  return jsonb_build_object(
    'cnpj', coalesce(v->>'cnpj', '(configure em Plataforma > Configurações)'),
    'razao_social', coalesce(v->>'razao_social', '(configurar)'),
    'nome_exibicao', coalesce(v->>'nome_exibicao', 'TECH-IVA'),
    'portal_rtc', 'https://consumo.tributos.gov.br',
    'ecac_controle_acesso', 'https://www.gov.br/receitafederal/pt-br/assuntos/meu-cnpj/controle-de-acesso');
end $$;

create or replace function public.set_platform_identity(p_cnpj text, p_razao text, p_nome text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not is_platform() then raise exception 'forbidden'; end if;
  perform require_aal2();
  select id into v_id from tenants where kind='platform' limit 1;
  update tenants set settings = coalesce(settings,'{}'::jsonb) ||
    jsonb_build_object('identity', jsonb_build_object(
      'cnpj', p_cnpj, 'razao_social', p_razao, 'nome_exibicao', p_nome))
  where id = v_id;
  perform log_audit(v_id,'platform.identity','tenant',v_id::text,null,
                    jsonb_build_object('cnpj',p_cnpj,'razao_social',p_razao));
end $$;
