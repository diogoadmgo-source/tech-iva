# PLATAFORMA DE CAIXA E PREÇO SOB IVA PARA PMEs
## Especificação de Produto, Arquitetura e Plano de Implementação — v1.0 (ago/2026)

> Nome de trabalho: **FLUXA** (a definir). Documento-mestre para implementação no Lovable + Supabase + serviços em container. Cada fase abaixo é autocontida, com entregáveis, critérios de aceite e o prompt sugerido para o Lovable.

---

## 0. Sumário executivo

**O que é:** um sistema SaaS multi-tenant que lê as notas fiscais de uma PME (emitidas e recebidas), classifica clientes e fornecedores por regime tributário, calcula IBS/CBS pelo motor oficial da Receita e mostra, todo dia, **quanto dinheiro o novo imposto vai tirar do caixa, quando o crédito volta, qual o preço certo por produto e por cliente, e como financiar o buraco**.

**Para quem:** PMEs que vendem B2B (Simples com receita PJ relevante, Lucro Presumido), escritórios contábeis (canal), bancos/ERPs (white-label).

**Por que agora:** desde 03/08/2026 notas do regime regular sem IBS/CBS são rejeitadas; em set/2026 e mar/2027 o Simples decide tradicional × híbrido; em 2027 entra CBS integral e o split payment começa a apertar o caixa; a transição roda até 2033.

**Diferencial que não se copia em 6 meses:** (1) financiar o buraco de caixa na mesma tela (FIDC por baixo do software), (2) o cruzamento nota × regime do CNPJ × extrato bancário em escala, (3) preço piso/alvo por cliente como saída, (4) canal contábil com comissão recorrente sobre o crédito.

**Stack:** Lovable (front + admin) → Supabase (Postgres com RLS hierárquica, Auth, Storage) ← serviços em container (ingestão de DF-e, calculadora da Receita, classificação de cadeia, motor de crédito).

---

## 1. Tese de negócio

### 1.1 A dor, em ordem de urgência (pesquisa ago/2026)
| # | Dor | Quem sente | Quando dói | Durabilidade |
|---|-----|-----------|-----------|--------------|
| 1 | Nota rejeitada / parametrização CST × cClassTrib errada | Regime regular (Simples em 2027) | Agora | Curta (12–18 meses) — ERPs vão absorver |
| 2 | Decisão Simples tradicional × híbrido | Simples com receita PJ | set/2026, mar/2027, depois anual | Média — vira rotina anual |
| 3 | Buraco de caixa do split payment (imposto sai no recebimento, crédito volta em até 180 dias) | Todo B2B | 2027 em diante | Longa (até 2033+) |
| 4 | Conciliação para apuração assistida (IBS, CBS, ERP, DF-e, financeiro) | Todos | 2027 em diante | Longa, mas briga com SPED houses e ERPs |
| 5 | Empresa do Simples "achando que está fora" — recebe XML com campos novos | Simples | Agora | Média |

**Escolha:** o produto ataca a **dor 3 como núcleo**, com a **dor 2 como isca de aquisição** e o **preço/margem** como saída acionável. Dores 1 e 4 são funções secundárias (fase 6+).

### 1.2 O que o produto É / NÃO É
- **É:** gestão de caixa e de preço sob IVA, com financiamento acoplado.
- **Não é:** calculadora (a Receita já dá), validador de XML (commodity), emissor de nota, ERP, SPED.

### 1.3 Modelo de receita (três andares)
1. **SaaS por CNPJ** — faixas por faturamento (R$ 150 a R$ 600/mês). Paga a operação.
2. **Canal contábil** — licença de carteira + comissão recorrente sobre o que os clientes contratam. Distribuição barata, retenção alta.
3. **Receita financeira** — antecipação de crédito acumulado de IBS/CBS, linha para cobrir o descasamento do split, conta de provisão do imposto. Opera via FIDC próprio. É o motor de lucro.

### 1.4 Ordem de grandeza (para dimensionar, não projeção)
- Mercado servível: 1,5–2 mi de CNPJs B2B (Simples não-MEI + Presumido com receita PJ relevante).
- 10 mil pagantes × R$ 300 = R$ 36 mi ARR; 30 mil = R$ 108 mi ARR.
- CAC via contador: R$ 300–600; direto: R$ 1.500–3.000. Churn alvo do cockpit: 1–2%/mês.
- Cenário 3 anos conservador: 8–10 mil CNPJs, R$ 30–40 mi ARR + carteira de crédito R$ 150–250 mi via FIDC.

---

## 2. Personas e hierarquia de tenants

A hierarquia é **recursiva** (uma tabela `tenants` com `parent_id`), não três tabelas fixas. Níveis típicos:

| Nível | Quem | Vê o quê | Faz o quê |
|-------|------|----------|-----------|
| **0 — Plataforma** | Operadora (nós) | Tudo | Planos, versão da calculadora, políticas de crédito, comissões, marca-mãe, fala com o FIDC |
| **1 — Canal** | Escritório contábil, franqueado, banco, ERP white-label | Só a própria carteira | Marca própria, usuários do canal, painel de carteira, comissão |
| **2 — Empresa** | CNPJ raiz do cliente | Só os próprios dados | Caixa do imposto, carteira, preço, regime, financiamento; usuários com papéis |
| **3 — Unidade** | Filial / unidade de negócio | Só a própria unidade | Consolidação por unidade |

Um nível 1 pode ter outro nível 1 abaixo (banco → escritórios → empresas). O caminho é materializado (`ltree`): `root.canal_x.empresa_y.filial_z`.

### 2.1 Papéis (roles) dentro de um tenant
- `owner` — tudo, inclusive faturamento e usuários.
- `finance` — caixa, financiamento, aceite de ofertas.
- `commercial` — preço, carteira de clientes.
- `viewer` — leitura.
- No nível 0: `platform_admin`, `platform_ops`, `platform_risk` (crédito).
- No nível 1: `channel_admin`, `channel_analyst`.

---

## 3. Arquitetura

### 3.1 Visão
```
[Lovable app: React + Tailwind + shadcn]  ──►  [Supabase]
   • App da empresa (5 telas)                    • Postgres (RLS hierárquica, ltree)
   • Painel do canal                             • Auth (email/senha, magic link, SSO depois)
   • Painel da plataforma                        • Storage (XMLs, relatórios)
   • Landing / onboarding                        • Realtime (status de ingestão)
                                                 • Edge Functions (leve: webhooks, gatilhos)
                                                        ▲
[Serviços em container — Node/Python, fila]  ───────────┘
   • Ingestor DF-e (por CNPJ, com retentativa)
   • Calculadora RTC da Receita (offline, versionada, API interna)
   • Classificador de cadeia (regime por CNPJ, cache)
   • Projetor de caixa (motor de eventos)
   • Motor de preço (piso/alvo por item × cliente)
   • Motor de crédito (ledger próprio, isolado)
   • Open Finance (extrato)
```

### 3.2 Dois planos, separados desde o dia 1
- **Plano de controle:** tenants, usuários, papéis, planos, cobrança, chaves de API, marca do canal, versão de regra. Muda pouco; onde mora a segurança.
- **Plano de dados:** notas, cadeia, cálculos, projeções, ofertas. Volumoso; onde mora a escala. Particionar por `tenant_id` (e por mês nas tabelas de eventos).

### 3.3 Princípios não negociáveis
1. **RLS em tudo.** Nenhuma tabela de dado sem `tenant_id` e política. Nenhuma query no front sem passar por RLS.
2. **Fila por CNPJ.** Um cliente com 50 mil notas não trava os outros.
3. **Regra versionada.** Toda linha calculada guarda `rule_version` (versão da calculadora + tabela cClassTrib). Mudou a regra → reprocessa e mostra a diferença ao cliente.
4. **Auditoria imutável** em tudo que toca dinheiro e cálculo (`audit_log` append-only: quem, o quê, quando, com que versão).
5. **Motor de crédito isolado** — ledger próprio, schema próprio, auditado por outra régua (BACEN/CVM via FIDC).
6. **O que é da Receita fica fora do Lovable.** A calculadora roda em container próprio e é exposta como API interna. O Lovable nunca chama a Receita direto.

### 3.4 O que fica no Lovable e o que fica fora
| No Lovable / Supabase | Fora (serviços em container) |
|---|---|
| Todas as telas e o admin | Ingestão de XML/DF-e (longa, com retry) |
| Auth, RLS, tabelas, storage | Calculadora oficial da Receita (offline) |
| Edge functions leves (webhook de status, disparo de job, e-mail) | Classificação de cadeia em lote |
| Realtime de status | Projeção de caixa e motor de preço em lote |
| Relatórios PDF simples | Open Finance, motor de crédito, integração FIDC |

---

## 4. Modelo de dados (esqueleto)

### 4.1 Plano de controle
```sql
create extension if not exists ltree;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references tenants(id),
  path ltree not null,               -- ex.: root.c1.e42
  level smallint not null,           -- 0,1,2,3
  kind text not null check (kind in ('platform','channel','company','unit')),
  name text not null,
  cnpj text,                          -- obrigatório para company/unit
  brand jsonb default '{}',           -- logo, cores (white-label do canal)
  plan_id uuid,
  status text default 'active',
  created_at timestamptz default now()
);
create index on tenants using gist (path);

create table memberships (
  user_id uuid references auth.users(id),
  tenant_id uuid references tenants(id),
  role text not null,
  primary key (user_id, tenant_id)
);

create table plans (id uuid primary key, name text, price_cents int, limits jsonb, features jsonb);
create table subscriptions (tenant_id uuid, plan_id uuid, status text, started_at timestamptz, ends_at timestamptz);
create table rule_versions (id uuid primary key, calc_version text, cclasstrib_version text, valid_from date, notes text);
create table audit_log (id bigserial primary key, tenant_id uuid, actor uuid, action text, entity text, entity_id text, before jsonb, after jsonb, rule_version_id uuid, at timestamptz default now());
```

### 4.2 Função de escopo e RLS hierárquica
```sql
-- caminhos que o usuário logado enxerga (o próprio nó e tudo abaixo)
create or replace function auth_scopes() returns setof ltree
language sql stable security definer as $$
  select t.path from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid();
$$;

-- política padrão (repetir para toda tabela de dado):
alter table invoices enable row level security;
create policy tenant_read on invoices for select using (
  exists (select 1 from tenants t where t.id = invoices.tenant_id
          and t.path <@ any (array(select auth_scopes())))
);
-- escrita: só no próprio tenant (não em descendentes), salvo platform
```
Regra: o nível superior **lê** os descendentes; **escreve** apenas no próprio tenant. Ações no nível de baixo (ex.: canal aprovando algo na empresa) passam por função RPC com `security definer` e ficam no `audit_log`.

### 4.3 Plano de dados (núcleo)
```sql
create table counterparties (       -- clientes e fornecedores
  id uuid primary key, tenant_id uuid not null, cnpj text not null,
  name text, role text check (role in ('customer','supplier','both')),
  regime text,                       -- simples | simples_hibrido | presumido | real | mei | pf | desconhecido
  regime_source text, regime_checked_at timestamptz,
  credit_transfer_pct numeric,       -- quanto de crédito este CNPJ transfere/aproveita
  unique (tenant_id, cnpj)
);

create table invoices (              -- DF-e emitidos e recebidos
  id uuid primary key, tenant_id uuid not null, direction text check (direction in ('out','in')),
  model text, key text unique, issued_at date, counterparty_id uuid,
  total_cents bigint, ibs_cents bigint, cbs_cents bigint, is_cents bigint,
  raw_xml_path text, status text, rule_version_id uuid, ingested_at timestamptz
);
create table invoice_items (
  id uuid primary key, tenant_id uuid not null, invoice_id uuid, line int,
  ncm text, cst text, cclasstrib text, description text, qty numeric,
  unit_price_cents bigint, base_cents bigint, ibs_cents bigint, cbs_cents bigint,
  credit_eligible boolean, credit_cents bigint, inconsistency jsonb
);
create table receivables (           -- quando o cliente paga (previsão e realizado)
  id uuid primary key, tenant_id uuid not null, invoice_id uuid, due_date date, paid_at date, amount_cents bigint, source text
);
create table tax_cash_events (       -- o coração do "caixa do imposto"
  id bigserial primary key, tenant_id uuid not null, event_date date, kind text, -- tax_out | credit_in | provision
  amount_cents bigint, ref_invoice_id uuid, confidence numeric, rule_version_id uuid, computed_at timestamptz
);
create table products (id uuid primary key, tenant_id uuid not null, sku text, name text, ncm text, cost_cents bigint, current_price_cents bigint);
create table price_scenarios (id uuid primary key, tenant_id uuid not null, name text, target_margin numeric, valid_from date, status text);
create table price_lines (id uuid primary key, tenant_id uuid not null, scenario_id uuid, product_id uuid, counterparty_id uuid, floor_price_cents bigint, target_price_cents bigint, current_price_cents bigint, delta_pct numeric, below_floor boolean);
create table regime_simulations (id uuid primary key, tenant_id uuid not null, run_at timestamptz, inputs jsonb, results jsonb, recommendation text, next_window date);
create table bank_transactions (id uuid primary key, tenant_id uuid not null, account_id text, booked_at date, amount_cents bigint, description text, matched_invoice_id uuid);
create table alerts (id uuid primary key, tenant_id uuid not null, kind text, severity text, payload jsonb, created_at timestamptz, resolved_at timestamptz);
create table jobs (id uuid primary key, tenant_id uuid not null, kind text, status text, progress numeric, error text, started_at timestamptz, finished_at timestamptz);
```

### 4.4 Schema de crédito (isolado: `credit.*`)
`credit.offers` (tenant_id, kind: advance_credit | split_gap_line | provision_account, amount, cost, term, status), `credit.contracts`, `credit.ledger` (append-only), `credit.repayments`, `credit.risk_scores` (inputs: cadeia, sazonalidade, inadimplência histórica). Acesso apenas via RPC e serviço; nunca por select direto do front.

---

## 5. Módulos e telas

### 5.1 App da empresa (nível 2)

**T1 — Caixa do Imposto (home)**
- Hero: número único — "buraco líquido dos próximos 30 / 60 / 90 dias" com tendência.
- Gráfico de linha do tempo (12 semanas): três séries — imposto que sai (por data de recebimento), crédito que volta (por prazo de aproveitamento), saldo líquido. Faixa de confiança.
- Cartões: imposto retido no mês, crédito a recuperar, crédito acumulado (dias médios para voltar), provisão sugerida.
- Botão contextual: "Cobrir buraco de março" → abre T5.
- Componentes: hero metric card, area chart com bandas, KPI cards com sparkline, timeline drawer por semana.

**T2 — Carteira (mapa da cadeia)**
- Duas abas: Clientes / Fornecedores. Cada linha: CNPJ, nome, regime (badge), % da receita/compra, crédito transferido/perdido, semáforo, ação sugerida (renegociar, trocar, aceitar).
- Painel lateral ao clicar: histórico de notas, sensibilidade ("se ele exigir crédito integral, você fica X% mais caro").
- Filtros: regime, faixa de valor, risco. Exportar.
- Componentes: data table com virtualização, badges de regime, sheet lateral, gráfico de concentração (treemap).

**T3 — Preço**
- Cenário ativo (margem alvo, alíquota do ano). Tabela por produto: preço atual, piso, alvo, delta, flag "abaixo do piso".
- Toggle "por cliente": mesma tabela recalculada para um cliente (aproveita crédito ou não).
- Simulação de ano (2027 → 2033) via slider.
- Ações: aprovar cenário, exportar tabela (CSV/ERP), histórico de cenários.
- Componentes: editable data grid, slider de ano, diff visual, modal de aprovação com resumo de impacto.

**T4 — Regime (Simples tradicional × híbrido)**
- Wizard de 3 passos: confirmar carteira → premissas (margem, mix B2B/B2C, fornecedores) → resultado.
- Resultado: dois cenários lado a lado 2027–2033, recomendação com o número por trás, contador regressivo para a próxima janela de opção, botão "gerar relatório para o contador".
- Componentes: stepper, comparison cards, bar chart empilhado por ano, PDF export.

**T5 — Financiamento**
- Ofertas contextuais: antecipação de crédito acumulado (valor, custo, prazo), linha para o descasamento (valor, prazo, custo), conta de provisão.
- Aceite em dois passos (revisar → assinar), extrato do contrato, cronograma de baixa automática.
- Componentes: offer cards com breakdown de custo, drawer de contratação, timeline de repagamento, ledger view.

**Transversais**
- Onboarding: CNPJ → autorização (procuração eletrônica / e-CAC / certificado) → escolha de conectar banco → progresso da ingestão em tempo real → "sua operação foi lida: N notas, M contrapartes".
- Central de alertas (sino): classificação inconsistente, cliente mudou de regime, produto abaixo do piso, buraco acima do limite, janela de opção próxima.
- Configurações: usuários e papéis, plano e cobrança, integrações (ERP/emissor, banco), preferências de alerta.
- Relatório semanal por e-mail.

### 5.2 Painel do canal (nível 1)
- Carteira: lista de empresas ordenada por buraco de caixa e urgência de regime; filtros; busca.
- Cards agregados: CNPJs ativos, buraco total da carteira, ofertas em aberto, comissão do mês.
- Ações em lote: gerar relatório para N clientes, convidar empresa, atribuir analista.
- Marca própria (logo, cor primária, domínio) — o cliente vê a marca do canal.
- Comissões: extrato, previsão, regras.

### 5.3 Painel da plataforma (nível 0)
- Árvore de tenants (canais → empresas → unidades), busca, impersonar (com auditoria).
- Planos e assinaturas; versões de regra (publicar nova versão → disparar reprocessamento com prévia de impacto).
- Operações: filas por CNPJ, jobs com erro, saúde das integrações (Receita, SEFAZ, Open Finance).
- Crédito: políticas, limites, carteira do FIDC, inadimplência, aprovações manuais.
- Comissionamento de canais.

---

## 6. Design system (premium SaaS)

### 6.1 Direção
Sóbrio, denso na medida certa, "financeiro moderno": superfícies em camadas com profundidade sutil, tipografia forte para números, cor usada só para significado (semáforo, regime, dinheiro que entra/sai). Referências de sensação: Linear (nitidez), Stripe Dashboard (dados), Mercury (finanças). Nada de gradientes decorativos, nada de ícones grandes coloridos.

### 6.2 Tokens
- **Cor:** fundo `#0B0F14` (dark) / `#F7F8FA` (light) — dark como padrão do app, light no painel do canal opcional. Superfície em 3 elevações (`surface-0/1/2`) com borda `1px` de baixo contraste e sombra suave. Primária: azul-petróleo (`#1F6FEB` dark / `#1B4FD8` light). Semânticas: entrada `#1D9E75`, saída `#D85A30`, alerta `#F5A524`, neutro `#8B95A5`. Regimes com paleta própria de baixa saturação (Simples, Híbrido, Presumido, Real, MEI, PF).
- **Tipografia:** Inter (UI) + Geist Mono ou JetBrains Mono para valores monetários e CNPJ. Escala: 12 / 13 / 14 / 16 / 20 / 28 / 40. Números com `tabular-nums`.
- **Espaço/raio:** grid 4px; raio 8 (controles), 12 (cards), 16 (modais). Sombras: `0 1px 2px rgba(0,0,0,.2)` (nível 1) → `0 8px 24px rgba(0,0,0,.35)` (nível 3).
- **Motion:** 150–200 ms, ease-out; skeletons em vez de spinners; números com contagem animada ao carregar; transições de rota com fade curto.

### 6.3 Componentes (shadcn como base, estendidos)
- App shell: sidebar colapsável com seções (Caixa, Carteira, Preço, Regime, Financiamento), topbar com seletor de tenant/empresa (breadcrumb hierárquico), busca global (⌘K), sino de alertas, avatar.
- KPI card (valor, delta, sparkline, tooltip de definição), hero metric, area chart com bandas (Recharts), data table (TanStack) com virtualização, colunas fixas, agrupamento e export, badge de regime, semáforo, sheet lateral, stepper, comparison card, offer card com breakdown, timeline, ledger view, empty states ilustrados discretos, toasts.
- Estados: loading (skeleton), vazio, erro (com ação), permissão negada.
- Acessibilidade: contraste AA, foco visível, navegação por teclado nas tabelas.

---

## 7. Integrações

| Integração | Uso | Onde roda | Observações |
|---|---|---|---|
| Calculadora RTC da Receita (componente local + API REST) | Cálculo oficial de IBS/CBS/IS por item, memória de cálculo | Container próprio, versionado | Nunca chamada do front. Guardar `calc_version` por linha. |
| DF-e (NF-e, NFS-e nacional, CT-e) via distribuição / API | Ingestão de emitidas e recebidas | Ingestor em container, fila por CNPJ | Guardar XML bruto no Storage; parse idempotente pela chave. |
| Consulta de regime por CNPJ (Receita / Simples Nacional) | Classificar contrapartes | Classificador em lote com cache (TTL 30 dias) | Fonte e data em `regime_source/checked_at`. |
| Open Finance (agregador) | Extrato, previsão de recebimento | Serviço próprio | Opcional no onboarding; melhora a confiança do caixa. |
| ERP/emissor (Bling, Tiny, Omie, ContaAzul…) | Exportar tabela de preço, importar produtos/custos | Edge function + API | Fase 5. |
| FIDC / motor de crédito | Ofertas, contratação, ledger, baixa | Serviço isolado | Fase 6; assinatura eletrônica; políticas em nível 0. |
| E-mail transacional | Alertas e relatório semanal | Edge function | — |

---

## 8. Plano de implementação por fases

Cada fase tem: objetivo, entregáveis, critérios de aceite, prompt-base para o Lovable. Fases 0–3 formam o MVP (alvo: nov/2026, para captar carteira antes da janela de mar/2027).

### Fase 0 — Fundação multi-tenant (1–2 semanas)
**Objetivo:** esqueleto que decide tudo depois: tenants hierárquicos, papéis, RLS, app shell.
**Entregáveis:** projeto Supabase com schema do plano de controle (§4.1), `ltree`, `auth_scopes()`, políticas; seed com tenant 0 (plataforma), 1 canal, 2 empresas, 1 unidade; Auth (e-mail/senha + magic link); Lovable com app shell (sidebar, topbar com seletor hierárquico de tenant, ⌘K, sino), tema dark/light, tokens do design system, telas de login/convite/troca de tenant; painel de plataforma mínimo (árvore de tenants + criar/convidar); `audit_log` funcionando em criar/editar tenant e membership.
**Aceite:** usuário do canal enxerga suas 2 empresas e não a terceira; usuário da empresa não enxerga o canal; usuário da plataforma enxerga tudo; toda escrita fora do próprio tenant é rejeitada pela RLS; troca de tenant no topbar filtra tudo.
**Prompt Lovable (resumo):** "Crie um SaaS multi-tenant hierárquico com Supabase. Tabela `tenants` com `parent_id` e `path ltree`, níveis platform/channel/company/unit; `memberships` com roles; função `auth_scopes()`; RLS: leitura no próprio nó e descendentes, escrita só no próprio nó. App shell dark premium (Inter + mono, superfícies em 3 elevações, sidebar colapsável, seletor hierárquico de tenant no topbar, ⌘K, sino). Telas: login, convite, seleção de tenant, árvore de tenants para platform_admin. Registre tudo em `audit_log`."

### Fase 1 — Ingestão e Carteira (2–3 semanas)
**Objetivo:** ler a operação da empresa e mostrar a cadeia por regime.
**Entregáveis:** tabelas do plano de dados (§4.3); serviço ingestor (fora do Lovable) que baixa DF-e por CNPJ, grava XML no Storage, parseia para `invoices/invoice_items`, atualiza `jobs` com progresso; classificador de regime com cache; onboarding com progresso em Realtime; tela T2 (Carteira) completa; alertas de "cliente mudou de regime" e "nota com CST × cClassTrib inconsistente".
**Aceite:** empresa com 5 mil notas ingerida em < 10 min sem afetar outra fila; 95% das contrapartes com regime classificado; T2 responde em < 500 ms com 10 mil linhas; XML bruto recuperável por chave.
**Prompt Lovable:** telas de onboarding (CNPJ → autorização → conectar banco opcional → progresso realtime), T2 com data table virtualizada, badges de regime, sheet lateral com histórico e sensibilidade, treemap de concentração; central de alertas.

### Fase 2 — Calculadora + Caixa do Imposto (2–3 semanas)
**Objetivo:** o produto passa a existir: mostra o buraco.
**Entregáveis:** calculadora RTC em container, versionada; motor que gera `tax_cash_events` a partir de notas + prazos de recebimento (histórico ou Open Finance) + prazo de retorno de crédito; tela T1 (home) com hero, timeline de 12 semanas, KPIs, drawer semanal; relatório semanal por e-mail; reprocessamento por `rule_version` com prévia de impacto no painel da plataforma.
**Aceite:** todo item calculado tem `rule_version`; publicar nova versão reprocessa e mostra delta; a projeção bate com a soma dos eventos; home carrega em < 1 s com dados cacheados.
**Prompt Lovable:** T1 com hero metric, area chart de 3 séries com bandas de confiança, KPI cards com sparkline, drawer por semana; tela de versões de regra no painel da plataforma com "publicar e reprocessar" e diff.

### Fase 3 — Regime (isca) + Relatório do contador (1–2 semanas)
**Objetivo:** capturar a demanda das janelas de opção e alimentar o canal.
**Entregáveis:** T4 (wizard tradicional × híbrido, 2027–2033, recomendação, contador regressivo para a próxima janela), PDF "relatório para o contador"; painel do canal v1 (carteira ordenada por buraco e urgência, gerar relatório em lote, convidar empresa, marca própria).
**Aceite:** simulação roda em < 5 s por empresa; canal gera 50 relatórios em lote; white-label aplica logo e cor em todo o app da empresa.
> **MVP fecha aqui.** Vender para os primeiros 500 escritórios / 200 CNPJs piloto (piloto com escritórios contábeis parceiros).

### Fase 4 — Preço (2 semanas)
**Entregáveis:** `products`, `price_scenarios`, `price_lines`; motor de piso/alvo por item e por cliente (considera crédito da entrada e regime do cliente); T3 com grid editável, slider de ano, aprovação, export; alerta "produto abaixo do piso".
**Aceite:** cenário com 5 mil SKUs × 40 clientes calcula em < 30 s; export CSV importável nos ERPs-alvo.

### Fase 5 — Integrações de saída (2 semanas)
**Entregáveis:** conectores ERP/emissor (importar produtos e custos, exportar tabela de preço), Open Finance completo com conciliação em `bank_transactions` → melhora `confidence` dos eventos; API pública por tenant (chave em nível 1/2) e webhooks.

### Fase 6 — Financiamento (4–6 semanas, em paralelo com o jurídico do FIDC)
**Entregáveis:** schema `credit.*` isolado; políticas de risco em nível 0; motor de oferta (antecipação de crédito acumulado, linha de descasamento, conta de provisão); T5 com aceite em dois passos e assinatura eletrônica; ledger e baixa automática; painel de crédito na plataforma; comissão do canal sobre crédito.
**Aceite:** nenhuma leitura de `credit.*` fora de RPC; toda oferta e aceite no `audit_log`; conciliação diária do ledger com o FIDC.

### Fase 7+ — Secundárias
Validador pré-emissão de XML (dor 1) como utilitário; conciliador de apuração assistida (dor 4); SSO/SAML para canais grandes; banco dedicado por tenant como plano premium; app mobile (resumo semanal e aceite de ofertas).

---

## 9. Regras de qualidade para o Lovable (colar em toda fase)
1. Toda tabela nova: `tenant_id not null` + RLS + índice em `(tenant_id, …)`.
2. Nada de lógica tributária no front. O front lê tabelas materializadas e chama RPCs.
3. Toda ação que muda dinheiro, regra ou permissão grava em `audit_log`.
4. Componentes do design system (§6) antes de inventar novos; estados de loading/vazio/erro em toda tela.
5. Números monetários em `cents` (bigint) no banco; formatação só na tela; `tabular-nums`.
6. Nunca `localStorage` para dado de negócio; estado de servidor via TanStack Query.
7. Testes de RLS por fase: usuário do canal, da empresa e da plataforma tentando ler/escrever fora do escopo.

---

## 10. Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Split payment escorregar e a dor de caixa demorar | Preço/margem (Fase 4) dói já em 2027 com CBS integral; simulador (Fase 3) traz o cliente antes |
| ERP grande embutir caixa/preço | Camada financeira (Fase 6) que ERP não tem licença nem apetite para operar; dado de cadeia acumulado |
| Regulatório do crédito | FIDC já existe; SCD/parceiro bancário como alternativa; motor isolado e auditável |
| Canal contábil cortejado por concorrente | Comissão recorrente sobre crédito + marca própria + integração com o dado que ele já usa |
| Mudança de regra pela Receita | Regra versionada + reprocessamento com prévia de impacto |
| Escala de ingestão | Fila por CNPJ, idempotência por chave, serviços fora do Lovable |

---

## 11. Métricas do produto
- Ativação: % de CNPJs que concluem onboarding e veem o primeiro "buraco" em < 15 min.
- Engajamento: sessões/semana no T1; abertura do relatório semanal.
- Valor: R$ de buraco identificado; R$ de crédito recuperável identificado; % de produtos reprecificados.
- Negócio: CNPJs pagantes, ARR, churn mensal, CAC por canal, take-rate financeiro, inadimplência da carteira.

---

## 12. Glossário
IBS/CBS (novos tributos), CST/cClassTrib (códigos por item no XML), split payment (retenção do imposto no pagamento), apuração assistida (Fisco consolida débitos/créditos), Simples híbrido (IBS/CBS fora do DAS), DF-e (documentos fiscais eletrônicos), RLS (segurança por linha no Postgres), ltree (caminho hierárquico), FIDC (fundo que compra recebíveis/crédito).

---

*Próximos passos imediatos:* (1) criar projeto Supabase e aplicar §4.1–4.2; (2) criar projeto no Lovable com o prompt da Fase 0; (3) subir o container da calculadora RTC; (4) selecionar 200 CNPJs piloto.
