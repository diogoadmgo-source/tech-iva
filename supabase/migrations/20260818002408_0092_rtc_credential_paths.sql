-- Migration 20260818002408 (0092_rtc_credential_paths) — exportada de supabase_migrations.schema_migrations
-- Dois caminhos para a credencial da apuração, ambos suportados e explicados.
-- O CNPJ da plataforma (que o cliente precisa informar no e-CAC ao nos nomear
-- procurador) fica em configuração, não no código.

insert into platform_notices (key, scope, severity, title, body) values
('rtc_credencial_proprio', 'integracoes_rtc', 'info',
 'Opção 1 — Você mesmo gera a credencial (mais rápido)',
 E'1. Acesse https://consumo.tributos.gov.br e entre com sua conta gov.br.\n'||
 E'2. Se você não usa certificado de pessoa jurídica (e-CNPJ), clique no seu nome no canto superior direito e use "Representar" para atuar em nome da empresa.\n'||
 E'3. No menu, procure o serviço "Gerar Credencial de Acesso para API".\n'||
 E'4. Gere o par ClientId e ClientSecret e cole os dois campos aqui.\n\n'||
 'A credencial é sua e você pode revogá-la no portal a qualquer momento.'),
('rtc_credencial_procurador', 'integracoes_rtc', 'info',
 'Opção 2 — Você nos autoriza como procurador (não precisa gerar nada)',
 E'1. Acesse o site da Receita Federal e vá em Serviços > Negócios > Controle de Acesso.\n'||
 E'2. Clique em "Minhas Autorizações de Acesso" e conceda autorização para o nosso CNPJ (exibido abaixo).\n'||
 E'3. Autorize os serviços: "Minhas Apurações Assistidas de CBS" e "Gerar Credencial de Acesso para API".\n'||
 E'4. Volte aqui e clique em "Já autorizei" — nós geramos a credencial de procurador e cuidamos do resto.\n\n'||
 'A autorização só passa a valer após a nossa confirmação, e você pode cancelá-la quando quiser, direto no e-CAC.')
on conflict (key) do nothing;

-- CNPJ e dados da plataforma para o banner (editáveis pela plataforma, sem deploy)
create or replace function platform_identity()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
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
grant execute on function platform_identity() to authenticated;

create or replace function set_platform_identity(p_cnpj text, p_razao text, p_nome text)
returns void language plpgsql security definer set search_path = public, extensions as $$
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
grant execute on function set_platform_identity(text,text,text) to authenticated;

-- Qual caminho cada empresa escolheu, e em que estágio está
create or replace function rtc_credential_state(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
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
grant execute on function rtc_credential_state(uuid) to authenticated;
