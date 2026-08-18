-- 0151_credencial_falha_tolerante.sql
-- ESPELHO da migration aplicada por você no fluxa-dev.
--
-- Defeito corrigido: marcar status='erro' na PRIMEIRA falha derrubava a ingestão
-- do cliente por causa de uma instabilidade de rede — a Receita oscila, e o
-- cliente ficava sem ingestão até alguém reativar à mão. Agora:
--   • conta falhas CONSECUTIVAS (integration_credentials.falhas_consecutivas);
--   • só na 3ª seguida marca 'erro' e abre alerta CRÍTICO;
--   • o primeiro sucesso zera o contador e REABILITA sozinho.

alter table public.integration_credentials
  add column if not exists falhas_consecutivas integer not null default 0;

create or replace function public.log_credential_use(p_credential uuid, p_finalidade text, p_sucesso boolean,
                                                     p_job uuid default null::uuid, p_worker text default null::text,
                                                     p_detalhe text default null::text)
returns void
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_tenant uuid; v_falhas int;
begin
  select tenant_id into v_tenant from integration_credentials where id = p_credential;
  if v_tenant is null then raise exception 'credencial inexistente'; end if;

  insert into credential_usage (credential_id, tenant_id, finalidade, job_id, worker, sucesso, detalhe)
  values (p_credential, v_tenant, p_finalidade, p_job, p_worker, p_sucesso, left(p_detalhe, 500));

  if p_sucesso then
    -- sucesso limpa o histórico de falhas e reabilita
    update integration_credentials
       set last_used_at = now(), last_error = null, falhas_consecutivas = 0,
           status = case when status = 'erro' then 'ativa'::credential_status else status end
     where id = p_credential;
  else
    update integration_credentials
       set last_used_at = now(), last_error = left(p_detalhe,500),
           falhas_consecutivas = falhas_consecutivas + 1
     where id = p_credential
    returning falhas_consecutivas into v_falhas;

    -- só depois de 3 falhas seguidas consideramos que há problema real
    if v_falhas >= 3 then
      update integration_credentials set status = 'erro' where id = p_credential;
      insert into alerts (tenant_id, kind, severity, title, payload)
      values (v_tenant, 'credential_error', 'critical',
              'Certificado com falha em 3 tentativas seguidas — ingestão parada',
              jsonb_build_object('credential_id', p_credential, 'ultimo_erro', left(p_detalhe,300)));
    end if;
  end if;
end $function$;

revoke all on function public.log_credential_use(uuid, text, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_credential_use(uuid, text, boolean, uuid, text, text) to service_role;
