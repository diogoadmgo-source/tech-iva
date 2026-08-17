# 02 — APIs E SERVIÇOS

> Objetivo: definir **todos os contratos** entre front (Lovable), banco (Supabase) e serviços em container, para que as telas do 03 só consumam. Três camadas: **A) RPCs no Postgres** (o front chama; RLS garante), **B) Edge Functions** (webhooks, e-mail, gatilho de jobs; service role só aqui), **C) Serviços em container** (pesado; falam com o Supabase por service role e publicam progresso via `jobs` + Realtime).

Regras: toda RPC exposta ao front é `security definer` + verificação explícita de escopo/papel + `log_audit` quando altera estado. Serviços em container **nunca** recebem chamada direta do front; são disparados por Edge Function ou por fila (`jobs`).

Blocos: A schema do plano de dados · B RPCs · C serviços · D edge functions · E jobs/realtime · F API pública e webhooks · G contratos JSON.

---

## A. Schema do plano de dados (migration 0010)

```sql
create type invoice_direction as enum ('out','in');
create type party_role as enum ('customer','supplier','both');
create type regime_kind as enum ('simples','simples_hibrido','presumido','real','mei','pf','imune','desconhecido');
create type cash_event_kind as enum ('tax_out','credit_in','provision','credit_advance','loan_in','loan_out');
create type job_status as enum ('queued','running','done','failed','canceled');
create type alert_severity as enum ('info','warning','critical');

create table counterparties (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  cnpj text not null, name text, role party_role not null default 'both',
  regime regime_kind not null default 'desconhecido', regime_source text, regime_checked_at timestamptz,
  credit_transfer_pct numeric(5,2),          -- % de crédito que este CNPJ transfere/aproveita
  revenue_share_pct numeric(5,2), purchase_share_pct numeric(5,2),  -- calculado
  risk_flag text, meta jsonb not null default '{}', created_at timestamptz not null default now(),
  unique (tenant_id, cnpj)
);
create table invoices (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  direction invoice_direction not null, model text not null, access_key text not null unique,
  number text, series text, issued_at date not null, counterparty_id uuid references counterparties(id),
  total_cents bigint not null, ibs_cents bigint default 0, cbs_cents bigint default 0, is_cents bigint default 0,
  credit_cents bigint default 0, raw_xml_path text, status text not null default 'authorized',
  rule_version_id uuid references rule_versions(id), inconsistencies jsonb not null default '[]',
  ingested_at timestamptz not null default now()
);
create index invoices_tenant_date on invoices (tenant_id, issued_at desc);
create index invoices_tenant_party on invoices (tenant_id, counterparty_id);

create table invoice_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  invoice_id uuid not null references invoices(id) on delete cascade, line int not null,
  product_id uuid, ncm text, cst text, cclasstrib text, description text, qty numeric(18,4), unit text,
  unit_price_cents bigint, base_cents bigint, ibs_cents bigint, cbs_cents bigint, is_cents bigint,
  credit_eligible boolean, credit_cents bigint, calc_memory jsonb, inconsistency jsonb,
  unique (invoice_id, line)
);
create index items_tenant_invoice on invoice_items (tenant_id, invoice_id);

create table receivables (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  invoice_id uuid references invoices(id) on delete cascade, installment int default 1,
  due_date date not null, expected_date date, paid_at date, amount_cents bigint not null,
  source text not null default 'invoice',        -- invoice | bank | manual
  confidence numeric(3,2) not null default 0.6
);
create index receivables_tenant_due on receivables (tenant_id, coalesce(expected_date,due_date));

create table tax_cash_events (
  id bigserial primary key, tenant_id uuid not null references tenants(id),
  event_date date not null, kind cash_event_kind not null, amount_cents bigint not null,
  ref_invoice_id uuid, ref_contract_id uuid, confidence numeric(3,2) not null default 0.6,
  rule_version_id uuid, computed_at timestamptz not null default now()
) partition by range (event_date);
-- criar partições mensais por job (ver C4)
create index tce_tenant_date on tax_cash_events (tenant_id, event_date);

create table products (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  sku text, name text not null, ncm text, cst_default text, cclasstrib_default text,
  cost_cents bigint, current_price_cents bigint, source text default 'invoice', active boolean default true,
  unique (tenant_id, sku)
);
create table price_scenarios (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  name text not null, target_margin numeric(5,2) not null, fiscal_year int not null,
  assumptions jsonb not null default '{}', status text not null default 'draft', -- draft|approved|archived
  approved_by uuid, approved_at timestamptz, rule_version_id uuid, created_at timestamptz default now()
);
create table price_lines (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  scenario_id uuid not null references price_scenarios(id) on delete cascade,
  product_id uuid not null references products(id), counterparty_id uuid,   -- null = preço geral
  cost_cents bigint, input_credit_cents bigint, floor_price_cents bigint, target_price_cents bigint,
  current_price_cents bigint, delta_pct numeric(6,2), below_floor boolean, memory jsonb,
  unique (scenario_id, product_id, counterparty_id)
);
create table regime_simulations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  run_at timestamptz default now(), inputs jsonb not null, results jsonb not null,
  recommendation text, next_window date, rule_version_id uuid, report_path text
);
create table bank_accounts (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id), provider text, external_id text, bank_name text, masked_number text, connected_at timestamptz, status text);
create table bank_transactions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  account_id uuid references bank_accounts(id), booked_at date not null, amount_cents bigint not null,
  description text, counterparty_hint text, matched_receivable_id uuid, match_confidence numeric(3,2), external_id text unique
);
create table alerts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  kind text not null, severity alert_severity not null, title text not null, payload jsonb not null default '{}',
  created_at timestamptz default now(), read_at timestamptz, resolved_at timestamptz, resolved_by uuid
);
create index alerts_tenant_open on alerts (tenant_id, created_at desc) where resolved_at is null;

create table jobs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  kind text not null,      -- ingest_dfe | classify_chain | compute_taxes | project_cash | price_scenario | regime_sim | reprocess_rules | bank_sync
  status job_status not null default 'queued', progress numeric(5,2) default 0, message text, error text,
  params jsonb not null default '{}', result jsonb, requested_by uuid,
  queued_at timestamptz default now(), started_at timestamptz, finished_at timestamptz, worker text
);
create index jobs_tenant_status on jobs (tenant_id, status, queued_at desc);

create table integrations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  kind text not null,      -- dfe_auth | openfinance | erp_bling | erp_omie | erp_tiny | emissor_x
  status text not null default 'pending', config jsonb not null default '{}', secret_ref text,
  connected_at timestamptz, last_sync timestamptz, error text
);

-- RLS padrão em TODAS as tabelas acima
do $$ declare t text; begin
  foreach t in array array['counterparties','invoices','invoice_items','receivables','tax_cash_events','products','price_scenarios','price_lines','regime_simulations','bank_accounts','bank_transactions','alerts','jobs','integrations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select to authenticated using (in_scope(tenant_id))', t, t);
  end loop; end $$;
-- Escrita pelo front: apenas nas tabelas de decisão do usuário, e só no próprio tenant com papel adequado
create policy products_write on products for all to authenticated using (role_in(tenant_id) in ('owner','commercial')) with check (role_in(tenant_id) in ('owner','commercial'));
create policy scenarios_write on price_scenarios for all to authenticated using (role_in(tenant_id) in ('owner','commercial')) with check (role_in(tenant_id) in ('owner','commercial'));
create policy alerts_update on alerts for update to authenticated using (in_scope(tenant_id)) with check (in_scope(tenant_id));
create policy integrations_write on integrations for all to authenticated using (can_admin(tenant_id) or role_in(tenant_id)='finance') with check (can_admin(tenant_id) or role_in(tenant_id)='finance');
-- Tudo o mais é escrito por serviços (service role) ou por RPC.

-- Views materializadas de leitura rápida (refresh por job)
create materialized view mv_cash_timeline as
select tenant_id, date_trunc('week', event_date)::date as week,
  sum(case when kind='tax_out' then amount_cents else 0 end) as tax_out_cents,
  sum(case when kind='credit_in' then amount_cents else 0 end) as credit_in_cents,
  sum(case when kind in ('tax_out') then -amount_cents when kind='credit_in' then amount_cents else 0 end) as net_cents,
  avg(confidence) as confidence
from tax_cash_events group by 1,2;
create unique index mv_cash_timeline_pk on mv_cash_timeline (tenant_id, week);
```

**Aceite A:** RLS de leitura ativa em 14 tabelas; `insert into invoices` como `authenticated` falha; `viewer` de outra empresa não lê `alerts` de Distribuidora Beta.

---

## B. RPCs (chamadas pelo front)

Assinatura → efeito → quem pode → auditoria. Todas `security definer`, `set search_path=public`, checam `in_scope`/`role_in` explicitamente.

| RPC | Parâmetros | Retorno | Quem | Efeito |
|---|---|---|---|---|
| `enqueue_job(p_tenant, p_kind, p_params)` | uuid, text, jsonb | job_id | owner/finance/commercial (por kind); channel_admin/platform para qualquer tenant do escopo | insere `jobs`; Edge `dispatch-job` acorda o serviço; audit `job.enqueue` |
| `cancel_job(p_job)` | uuid | void | mesmo do enqueue | status→canceled |
| `dashboard_cash(p_tenant, p_horizon_days)` | uuid, int | jsonb `{hero, kpis, timeline[], next_gap}` | escopo | lê `mv_cash_timeline` + `tax_cash_events` |
| `chain_map(p_tenant, p_role, p_filters)` | uuid, party_role, jsonb | setof jsonb (linhas da carteira com share, regime, crédito perdido, sensibilidade) | escopo | leitura agregada |
| `counterparty_detail(p_tenant, p_id)` | uuid, uuid | jsonb `{party, invoices_last12, sensitivity{...}}` | escopo | leitura |
| `run_regime_simulation(p_tenant, p_inputs)` | uuid, jsonb | job_id | owner/finance/channel_admin | enfileira `regime_sim` |
| `approve_price_scenario(p_scenario)` | uuid | void | owner/commercial | status→approved, arquiva anterior, audit `price.approve` |
| `export_price_scenario(p_scenario, p_format)` | uuid, text | signed_url | owner/commercial | gera CSV no Storage |
| `ack_alert(p_alert)` / `resolve_alert(p_alert, p_note)` | uuid | void | escopo | marca lido/resolvido; audit em resolve |
| `set_regime_manual(p_tenant, p_party, p_regime, p_reason)` | uuid, uuid, regime_kind, text | void | owner/finance/channel_admin | sobrescreve regime com `regime_source='manual'`; audit |
| `request_dfe_authorization(p_tenant, p_method)` | uuid, text | jsonb `{next_step, url?}` | owner/finance/channel_admin | cria `integrations(kind='dfe_auth')`; devolve instrução |
| `channel_portfolio(p_tenant, p_filters)` | uuid, jsonb | setof jsonb (empresas com buraco 30/60/90, urgência de regime, ofertas, última ingestão) | channel_admin/analyst/platform | leitura agregada nos descendentes |
| `platform_ops_overview()` | — | jsonb `{queues, failed_jobs, integrations_health, rule_current}` | platform | leitura |
| `publish_rule_version(p_id, p_dry_run)` | uuid, bool | jsonb `{impact_preview}` ou job_id | platform_admin | dry_run: calcula delta amostral; real: `is_current`, enfileira `reprocess_rules` para todos os tenants; audit `rule.publish` |
| `credit_offers(p_tenant)` | uuid | setof jsonb | owner/finance | lê `credit.offers` via função (schema isolado) |
| `accept_credit_offer(p_offer, p_signature_ref)` | uuid, text | contract_id | owner/finance (MFA aal2) | cria contrato, ledger; audit `credit.accept` |

Contrato de retorno de `dashboard_cash` (exemplo):
```json
{
  "hero": {"gap_30_cents": -5300000, "gap_60_cents": -9100000, "gap_90_cents": -12800000, "trend": -0.12},
  "kpis": {"tax_out_month_cents": 8400000, "credit_in_month_cents": 3100000, "credit_backlog_cents": 4100000, "credit_avg_days": 118, "provision_suggested_cents": 5300000},
  "timeline": [{"week":"2027-03-01","tax_out_cents":2100000,"credit_in_cents":800000,"net_cents":-1300000,"confidence":0.72}],
  "next_gap": {"week":"2027-03-15","amount_cents":-5300000,"offer_available":true}
}
```

---

## C. Serviços em container (repositório `fluxa-services`)

Stack sugerido: Node 20 + TypeScript (ou Python 3.12), fila **pg-boss** sobre o próprio Postgres (evita Redis) ou BullMQ; um deploy por serviço; segredo via variáveis; conexão com Supabase por service role. Todos leem `jobs`, escrevem progresso e publicam `jobs.progress` (Realtime). Idempotentes.

### C1 — Ingestor DF-e (`svc-ingest`)
- **Entrada:** job `ingest_dfe` `{tenant_id, cnpj, since, until, models:[nfe,nfse,cte]}`.
- **Fontes:** distribuição DF-e (NF-e), NFS-e nacional, CT-e — via credencial em `integrations(dfe_auth)` (certificado A1 armazenado cifrado ou procuração eletrônica).
- **Passos:** paginar → baixar XML → gravar `Storage: dfe/{tenant}/{yyyy-mm}/{chave}.xml` → parse → upsert `invoices` (por `access_key`) e `invoice_items` → upsert `counterparties` (cnpj) → gerar `receivables` (parcelas do XML ou prazo médio histórico) → detectar inconsistências (CST × cClassTrib, NCM, totais) → `alerts` → progresso.
- **Saída:** `result {invoices, items, parties_new, inconsistencies}`; encadeia `classify_chain` e `compute_taxes`.
- **Aceite:** 5 mil notas < 10 min; reexecução não duplica; falha em uma nota não derruba o job (registra em `error` detalhado).

### C2 — Classificador de cadeia (`svc-chain`)
- **Entrada:** `classify_chain {tenant_id, cnpjs?:[]}`.
- **Fonte:** consulta pública de regime (Simples/MEI) + base cadastral CNPJ; cache global (`chain_cache` fora de RLS, por cnpj, TTL 30 dias).
- **Regras:** determina `regime`, `credit_transfer_pct` (regular=100, simples=reduzido conforme regra vigente, mei/pf=presumido conforme LC 214 art. 169 quando aplicável), calcula `revenue_share_pct`/`purchase_share_pct`, marca `risk_flag` (cliente PJ regular que compra >X% e ainda não pediu crédito integral, fornecedor Simples com >Y% das compras). Nunca sobrescreve `regime_source='manual'`.
- **Saída:** `alerts` de "regime mudou" e "fornecedor sem crédito"; progresso.

### C3 — Calculadora RTC (`svc-calc`)
- **O quê:** container com o componente offline da Calculadora da Receita instalado, exposto como API interna REST **somente na rede privada**; um adaptador nosso na frente com cache por `(rule_version, ncm, cst, cclasstrib, uf_origem, uf_destino, municipio, valor)`.
- **Entrada:** `compute_taxes {tenant_id, invoice_ids?|since}`; para cada item chama a calculadora, grava `ibs/cbs/is`, `credit_eligible/credit_cents`, `calc_memory` (memória de cálculo oficial), `rule_version_id`.
- **Versionamento:** a imagem do container é taggeada com `calc_version`; `rule_versions.calc_version` aponta para a tag; `reprocess_rules` recalcula tudo com a nova versão e grava diff em `jobs.result`.
- **Aceite:** 100% dos itens com `rule_version_id`; recálculo com mesma versão é idempotente; memória de cálculo consultável na tela.

### C4 — Projetor de caixa (`svc-cash`)
- **Entrada:** `project_cash {tenant_id, horizon_days:120}`.
- **Modelo:** para cada `receivable` futuro: evento `tax_out` na data esperada de recebimento (split) com `amount = ibs+cbs da parcela`; para cada compra: `credit_in` na data de aproveitamento (regra vigente + comportamento histórico do tenant, default 90–180 dias); `provision` mensal sugerida; confiança = f(source do receivable, atraso histórico do cliente, Open Finance conectado). Considera contratos de crédito (`loan_in/loan_out`).
- **Saída:** substitui `tax_cash_events` do horizonte (delete+insert em transação), refresh `mv_cash_timeline`, `alerts` "buraco acima do limite" e "janela de opção em N dias".
- Cria partições mensais faltantes de `tax_cash_events`.

### C5 — Motor de preço (`svc-price`)
- **Entrada:** `price_scenario {tenant_id, scenario_id}`.
- **Modelo:** por produto (e por cliente quando solicitado): `floor = (custo − crédito recuperável na entrada) / (1 − alíquota efetiva do ano − despesas variáveis)`; `target = floor / (1 − margem alvo)`; ajuste por regime do cliente (se ele aproveita crédito integral/reduzido/nenhum) e por ano fiscal (transição de alíquotas). Grava `price_lines` com `memory`.
- **Aceite:** 5 mil SKUs × 40 clientes < 30 s; `below_floor` gera alerta.

### C6 — Motor de crédito (`svc-credit`) — schema `credit.*` (fase 6)
- Tabelas: `credit.policies` (nível 0), `credit.risk_scores`, `credit.offers`, `credit.contracts`, `credit.ledger` (append-only), `credit.repayments`, `credit.fidc_settlements`.
- Jobs: `score_tenant`, `generate_offers` (a partir de `next_gap` e `credit_backlog`), `settle_daily` (baixa por recebimento/crédito), `reconcile_fidc`.
- Acesso do front **exclusivamente** por RPCs `credit_offers`/`accept_credit_offer`; nenhuma policy de select direto.

### C7 — Open Finance (`svc-bank`)
- `bank_sync {tenant_id}`: extrato → `bank_transactions` → matching com `receivables` (valor±, data, CNPJ no histórico) → atualiza `paid_at`/`expected_date` e `confidence`.

### C8 — Regime (`svc-regime`)
- `regime_sim {tenant_id, inputs}`: roda carteira nos dois cenários 2027–2033 (tradicional × híbrido), usa C3 para alíquotas, grava `regime_simulations` + PDF (`Storage: reports/`), `next_window`.

Cada serviço expõe `GET /health` e `POST /run` (só rede interna). Logs estruturados com `tenant_id`, `job_id`.

---

## D. Edge Functions (Supabase; Lovable pode gerar)

| Função | Gatilho | Faz |
|---|---|---|
| `dispatch-job` | Database Webhook em `insert jobs` | POST para o serviço correspondente (`/run {job_id}`); marca `running` |
| `job-progress` | chamada pelo serviço | valida assinatura HMAC; atualiza `jobs`; (Realtime cuida do push) |
| `send-invite` | RPC `invite_user` (front chama depois) | e-mail transacional |
| `impersonate` | painel platform | sessão com claim `impersonated_by` |
| `weekly-digest` | cron seg 07:00 | por tenant company: monta resumo (gap, alertas, mudanças) e envia |
| `alerts-notify` | insert em `alerts` severity critical | e-mail/push imediato |
| `erp-webhook/:kind` | ERPs parceiros | valida assinatura, enfileira `ingest_erp` |
| `openfinance-callback` | provedor | grava consentimento em `integrations`, enfileira `bank_sync` |
| `storage-signed-url` | front | URL assinada para XML/relatório (checa `in_scope`) |

Regra: Edge Functions são finas; nada de regra tributária nelas.

---

## E. Jobs, progresso e Realtime

- Front assina `postgres_changes` em `jobs` filtrado por `tenant_id`; mostra progresso (barra, mensagem) no onboarding e num "job center" no topbar.
- Estados: queued → running (progress 0–100, message) → done|failed|canceled. `failed` traz `error` legível + botão "tentar de novo" (novo job com `params.retry_of`).
- Isolamento: fila **por tenant** (`singletonKey = tenant_id:kind`) — dois jobs iguais do mesmo tenant não rodam em paralelo; tenants diferentes sim. Limite de concorrência por serviço.
- Backoff exponencial (30 s, 2 min, 10 min, 1 h), máx. 5; alerta na plataforma após 3 falhas.

---

## F. API pública e webhooks (por tenant; fase 5)

- Autenticação: `Authorization: Bearer <api_key>` (hash em `api_keys`), escopos: `read:cash`, `read:chain`, `read:prices`, `write:products`, `webhooks`.
- Endpoints (Edge `api/v1`): `GET /cash/timeline`, `GET /chain`, `GET /prices/current`, `POST /products/bulk`, `POST /webhooks` (eventos: `job.done`, `alert.created`, `price.approved`, `credit.offer.created`).
- Rate limit por chave (600 req/h). Toda chamada em `audit_log` (`api.call`).

---

## G. Contratos JSON dos jobs (params/result)

```jsonc
// ingest_dfe
{"params":{"cnpj":"00.000.000/0001-00","since":"2025-08-01","until":"2026-08-17","models":["nfe","nfse","cte"]},
 "result":{"invoices":4812,"items":19330,"parties_new":57,"inconsistencies":41,"skipped":3}}

// classify_chain
{"params":{"cnpjs":null},"result":{"classified":312,"changed":9,"unknown":4}}

// compute_taxes
{"params":{"since":"2025-08-01"},"result":{"items":19330,"rule_version":"calc-3.2/cct-2026.07","credit_total_cents":41000000}}

// project_cash
{"params":{"horizon_days":120},"result":{"events":6210,"gap_30_cents":-5300000,"gap_90_cents":-12800000,"alerts":2}}

// price_scenario
{"params":{"scenario_id":"…"},"result":{"lines":200000,"below_floor":6,"avg_delta_pct":3.4}}

// regime_sim
{"params":{"assumptions":{"b2b_share":0.68,"margin":0.18,"switch_suppliers":false}},
 "result":{"traditional":{"2027":…,"2033":…},"hybrid":{"2027":…,"2033":…},"recommendation":"hybrid","delta_pct":-7.9,"next_window":"2027-03-01","report_path":"reports/…pdf"}}

// reprocess_rules
{"params":{"rule_version_id":"…","tenants":"all|[ids]"},"result":{"tenants":812,"items":9.4e6,"delta_summary":{"ibs_cents":…,"cbs_cents":…}}}
```

---

## Ordem de implementação desta fase
1. A (schema + RLS) → 2. D `dispatch-job`, `job-progress` + E → 3. C1 ingestor → 4. C2 classificador → 5. C3 calculadora → 6. B RPCs de leitura (`dashboard_cash`, `chain_map`, `counterparty_detail`) → 7. C4 projetor → 8. C8 regime + `channel_portfolio` → **MVP** → 9. C5 preço → 10. C7 banco + F → 11. C6 crédito.

Só o passo 1 e as RPCs do 6 são gerados/aplicados pelo Supabase; C1–C8 vivem em `fluxa-services`.
