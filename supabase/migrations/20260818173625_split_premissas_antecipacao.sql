-- Migration 20260818173625 (split_premissas_antecipacao) — exportada de supabase_migrations.schema_migrations
-- 0060 — Split Payment: premissas parametrizadas, antecipação de recebíveis e "tributo em aberto" no motor.
-- Fontes: Split Payment Manual de Operações (jun/2026) §2.2, §5.2, §5.3, §6.1.1; Manual de Tempos v1.0.0; Glossário RTC v3.
-- Texto integral e comentado em supabase/migrations/20260818200000_split_premissas_antecipacao.sql (repo tech-iva).

create or replace function public.premissa_credito_dias() returns integer
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select (settings->'premissas'->>'credito_dias')::int
                   from tenants where kind = 'platform' limit 1), 150);
$$;
comment on function public.premissa_credito_dias() is
  'Prazo médio (dias) entre a compra e o aproveitamento do crédito de IBS/CBS. Lido de tenants(platform).settings.premissas.credito_dias; default 150. Substituir por comportamento histórico do tenant quando o svc-bank/AA existir.';
comment on function public.premissa_dia_vencimento() is
  'Dia do mês seguinte em que o imposto sai do caixa na modalidade "apuracao". Lido de tenants(platform).settings.premissas.dia_vencimento_apuracao; default 30. Usado por data_saida_imposto() e pelo run-rate de project_cash_sql/comparar_modalidades.';
grant execute on function public.premissa_credito_dias() to authenticated;

alter table public.receivables
  add column if not exists tributo_em_aberto_cents bigint,
  add column if not exists antecipado_em date,
  add column if not exists antecipacao_ref uuid;
comment on column public.receivables.tributo_em_aberto_cents is
  'CBS/IBS "Em Aberto" (A) — limite máximo a recolher, informado pela Plataforma Pública via PSP ou lido da Apuração Assistida. NULL = desconhecido (fórmula ignora o termo). Manual de Operações §2.3/§5.2.';
comment on column public.receivables.antecipado_em is
  'Data em que o recebível foi antecipado (FIDC/banco). NÃO é liquidação financeira: não altera expected_date nem dispara segregação (Manual de Operações §6.1.1).';
comment on column public.receivables.antecipacao_ref is
  'Referência ao contrato/operação de antecipação (credit.contracts.id ou id externo).';
comment on column public.receivables.valor_pago_cents is
  'Vp da fórmula do split — valor efetivamente pago pelo pagador (parcial ou integral). Preenchido pelo svc-bank/conciliação.';
comment on column public.receivables.arranjo is
  'Arranjo de pagamento (Fase 1 B2B Opcional): boleto/pix_dinamico/pix_automatico = Super Inteligente; pix_estatico/ted/tef = Inteligente; demais fora do split.';

create or replace function public.receivables_guard_antecipacao() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if tg_op = 'UPDATE'
     and new.antecipado_em is not null
     and new.paid_at is null
     and new.expected_date is distinct from old.expected_date then
    raise exception using
      message = 'Antecipação de recebível não altera expected_date: o imposto sai na liquidação financeira real (Split Payment — Manual de Operações §6.1.1).',
      errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_receivables_guard_antecipacao on public.receivables;
create trigger trg_receivables_guard_antecipacao
  before update on public.receivables
  for each row execute function public.receivables_guard_antecipacao();

comment on function public.split_segregado_cents(arranjo_pagamento, bigint, bigint, bigint, bigint) is
  'R = mín((Vp/Vt)×C ; C ; A), truncado no centavo, por tributo. Arranjos iniciados pelo Pagador (pix_estatico/ted/tef) segregam o informado sem proporcionalidade. Fonte: Split Payment — Manual de Operações (jun/2026) §5.2–5.4.';
comment on function public.arranjo_tem_split(arranjo_pagamento) is
  'Fase 1 (B2B Opcional): boleto, pix_dinamico, pix_automatico, pix_estatico, ted, tef. Cartão/ITP/RAD fora. Manual de Operações §1.2/§2.2.';
comment on function public.arranjo_tem_proporcionalidade(arranjo_pagamento) is
  'Modelo Super Inteligente (iniciados pelo Recebedor): boleto, pix_dinamico, pix_automatico. Manual de Operações §2.1/§5.4.';

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'project_cash_sql';
  if v_def is null then raise exception 'project_cash_sql não encontrada'; end if;
  v_new := replace(v_def, 'issued_at + 150', 'issued_at + premissa_credito_dias()');
  v_new := replace(v_new, 'interval ''19 days''', 'make_interval(days => premissa_dia_vencimento() - 1)');
  v_new := replace(v_new, 'i.ibs_cents + i.cbs_cents, null)', 'i.ibs_cents + i.cbs_cents, r.tributo_em_aberto_cents)');
  if v_new = v_def then raise exception 'project_cash_sql: nenhuma substituição aplicada'; end if;
  if v_new like '%issued_at + 150%' or v_new like '%interval ''19 days''%' or v_new like '%i.cbs_cents, null)%' then
    raise exception 'project_cash_sql: substituição incompleta'; end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'comparar_modalidades';
  if v_def is null then raise exception 'comparar_modalidades não encontrada'; end if;
  v_new := replace(v_def, 'issued_at + 150', 'issued_at + premissa_credito_dias()');
  v_new := replace(v_new, 'interval ''19 days''', 'make_interval(days => premissa_dia_vencimento() - 1)');
  if v_new = v_def then raise exception 'comparar_modalidades: nenhuma substituição aplicada'; end if;
  if v_new like '%issued_at + 150%' or v_new like '%interval ''19 days''%' then
    raise exception 'comparar_modalidades: substituição incompleta'; end if;
  execute v_new;
end $$;

create schema if not exists _test;
create table if not exists _test.results (n text, expected text, got text, pass boolean, at timestamptz default now());
alter table _test.results add column if not exists at timestamptz default now();
create or replace function _test.record(p_n text, p_expected text, p_got text) returns void
language sql as $$ insert into _test.results (n, expected, got, pass) values (p_n, p_expected, p_got, p_expected = p_got); $$;

do $$
declare v_id uuid; v_err text;
begin
  perform _test.record('split boleto 70% de 100,00 tributo 12,35 -> 8,64', '864', split_segregado_cents('boleto',7000,10000,1235)::text);
  perform _test.record('split boleto pago a maior nao majora', '1235', split_segregado_cents('boleto',12000,10000,1235)::text);
  perform _test.record('split boleto limitado ao Em Aberto', '500', split_segregado_cents('boleto',10000,10000,1235,500)::text);
  perform _test.record('split pix_estatico sem proporcionalidade', '1235', split_segregado_cents('pix_estatico',7000,10000,1235)::text);
  perform _test.record('split truncamento 3333/10000*1000', '333', split_segregado_cents('boleto',3333,10000,1000)::text);
  perform _test.record('split cartao fora da fase 1', '0', split_segregado_cents('desconhecido',10000,10000,1235)::text);
  perform _test.record('premissa_credito_dias default', '150', premissa_credito_dias()::text);
  select r.id into v_id from receivables r where r.paid_at is null limit 1;
  if v_id is not null then
    begin
      update receivables set antecipado_em = current_date, expected_date = current_date where id = v_id;
      v_err := 'permitiu';
    exception when others then v_err := 'bloqueou'; end;
    perform _test.record('antecipacao nao move expected_date', 'bloqueou', v_err);
    begin
      update receivables set antecipado_em = current_date where id = v_id;
      v_err := 'permitiu';
    exception when others then v_err := 'bloqueou'; end;
    perform _test.record('antecipacao sem mover expected_date e permitida', 'permitiu', v_err);
    update receivables set antecipado_em = null where id = v_id;
  end if;
end $$;
