# 03 — TELAS E FUNCIONALIDADES (Lovable)

> Pré-requisitos: 01 aplicado e testado; 02 (A, B de leitura, C1–C4) rodando ao menos em staging com o seed. Este documento é **só front**: consome tabelas, views e RPCs já existentes. Cada bloco = um prompt para o Lovable (com o cabeçalho de contexto do README). Ordem: 3.1 design system → 3.2 shell/onboarding → 3.3 T2 → 3.4 T1 → 3.5 T4 → 3.6 canal → 3.7 T3 → 3.8 T5 → 3.9 plataforma → 3.10 alertas/relatórios → 3.11 aceite.

---

## 3.1 Design system (fazer ANTES de qualquer tela)

**Direção:** financeiro moderno, sóbrio, denso na medida. Sensação: Linear (nitidez), Stripe Dashboard (dados), Mercury (finanças). Sem gradientes decorativos, sem ícones coloridos grandes, sem ilustrações grandes. Profundidade vem de **camadas de superfície + borda de baixo contraste + sombra suave**, não de cor.

**Tokens (CSS vars + Tailwind config):**
```
--bg:            #0B0F14   (light: #F6F7F9)
--surface-0:     #0F141B   (light: #FFFFFF)
--surface-1:     #141A23   (light: #FFFFFF, sombra 1)
--surface-2:     #1A2230   (light: #FFFFFF, sombra 2)
--border:        rgba(255,255,255,.08)  (light: rgba(16,24,40,.08))
--border-strong: rgba(255,255,255,.14)  (light: rgba(16,24,40,.16))
--text-1:        #E6EAF0   (light: #0F172A)
--text-2:        #A5AFBF   (light: #475569)
--text-3:        #6B7686   (light: #94A3B8)
--primary:       #3B82F6   (hover #2F6FE0; light #1D4ED8)
--in:            #22C55E  (dinheiro que entra / crédito)
--out:           #F97316  (dinheiro que sai / imposto)
--warn:          #F59E0B
--danger:        #EF4444
--regime-simples: #8B5CF6  --regime-hibrido: #A78BFA  --regime-presumido: #06B6D4
--regime-real:    #14B8A6  --regime-mei: #64748B      --regime-pf: #94A3B8
--radius-sm: 8px  --radius-md: 12px  --radius-lg: 16px
--shadow-1: 0 1px 2px rgba(0,0,0,.25)
--shadow-2: 0 4px 12px rgba(0,0,0,.30)
--shadow-3: 0 12px 32px rgba(0,0,0,.40)
--font-ui: Inter; --font-mono: "JetBrains Mono"
```
Tipografia: 12/13/14/16/20/28/40; pesos 400/500/600; **valores monetários e CNPJ sempre em mono com `tabular-nums`**; hero em 40/600.

**Componentes a criar (em `/components/fluxa/`), estendendo shadcn:**
- `AppShell` (sidebar colapsável 240→64 px, topbar 56 px, conteúdo com max-width 1440 e padding 24)
- `TenantSwitcher` (breadcrumb hierárquico + popover de busca)
- `KpiCard` {label, value, delta, sparkline?, hint} — valor em mono; delta com seta e cor in/out
- `HeroMetric` {label, value, sub, trend, action}
- `CashTimelineChart` (Recharts AreaChart: 3 séries, banda de confiança, tooltip customizado, brush 12 semanas)
- `DataTable` (TanStack Table: virtualização, colunas fixas, ordenação, filtro por coluna, seleção, export CSV, densidade compacta/normal, sticky header)
- `RegimeBadge` {regime} — cor da paleta de regime, texto curto
- `Semaphore` {level: ok|warn|crit}
- `SideSheet` (painel lateral 480 px com header sticky e tabs)
- `Stepper` (horizontal, 3–4 passos, estado atual/concluído)
- `ComparisonCard` (dois cenários lado a lado com destaque do vencedor)
- `OfferCard` {kind, amount, cost, term, breakdown[], cta}
- `LedgerTable` (linhas débito/crédito com saldo corrente)
- `JobProgress` {job} — barra + mensagem + tempo estimado; e `JobCenter` no topbar
- `AlertBell` + `AlertList` (severidade, agrupamento por dia, ações)
- `EmptyState` {icon, title, hint, action} — discreto
- `MoneyText` {cents, sign?} — formatação BRL, mono, cor por sinal opcional
- `CnpjText` — mono formatado
- `DiffJson` (before/after) para auditoria
- `ImpersonationBanner`

**Motion:** 150–200 ms ease-out; skeleton em toda carga; números com count-up 400 ms; transição de rota fade 120 ms; sem bounce.

**Aceite 3.1:** página `/design` (rota interna) exibe todos os componentes nos estados normal/hover/loading/vazio/erro, dark e light. Só passa se números estiverem em mono tabular e as três elevações forem visivelmente distintas.

**Prompt 3.1:** "Crie o design system do FLUXA: tokens acima em CSS vars e Tailwind; componentes listados em /components/fluxa estendendo shadcn; página /design com galeria de todos os componentes em todos os estados, dark e light. Não crie telas de negócio ainda."

---

## 3.2 App shell, onboarding e navegação

**Rotas:**
```
/login /signup /forgot /reset /confirm /invite/:token /mfa /select-tenant /profile
/t/:tenantId                      → redireciona por kind (company→/cash, channel→/portfolio, platform→/tenants)
/t/:tenantId/onboarding           (company)
/t/:tenantId/cash | /chain | /prices | /regime | /credit | /alerts | /settings/* (company/unit)
/t/:tenantId/portfolio | /companies | /reports | /brand | /commissions | /settings/* (channel)
/t/:tenantId/tenants | /plans | /rules | /ops | /credit-admin | /audit (platform)
```
Guardas: membership no escopo (`in_scope`), papel por rota (ex.: `/credit` só owner/finance), MFA aal2 para platform/channel_admin.

**Onboarding (company), 4 passos com `Stepper`:**
1. **Empresa** — CNPJ (consulta pública preenche razão social/UF), regime declarado, e-mail do contador (opcional, cria convite `viewer` no canal? não: convite `viewer` na empresa).
2. **Autorizar notas** — cartões: "Certificado A1" (upload cifrado → `integrations dfe_auth`), "Procuração eletrônica" (instruções + botão "já autorizei"), chama `request_dfe_authorization`.
3. **Conectar banco (opcional)** — cartão Open Finance (redirect ao provedor; volta por callback) ou "pular por enquanto" com explicação de que a confiança do caixa sobe com o banco.
4. **Lendo sua operação** — `JobProgress` do `ingest_dfe` → `classify_chain` → `compute_taxes` → `project_cash` (Realtime); ao concluir: cartão "Sua operação foi lida: N notas, M clientes, K fornecedores, primeiro buraco identificado: R$ X" e botão "Ver meu caixa".

**Aceite 3.2:** trocar tenant no topbar troca todo o conteúdo e a marca; onboarding retomável (estado em `integrations` + `jobs`); rota sem permissão mostra estado "sem permissão" (não 404).

---

## 3.3 T2 — Carteira (mapa da cadeia)

**Fonte:** RPC `chain_map`, `counterparty_detail`, `set_regime_manual`; tabela `alerts`.
**Layout:** header com título, resumo (N clientes · N fornecedores · % receita PJ regular · crédito perdido/ano) e toggle Clientes/Fornecedores. Abaixo, à esquerda **treemap de concentração** (por regime → por CNPJ), à direita `DataTable`.
**Colunas (clientes):** CNPJ · Nome · `RegimeBadge` · % receita · Receita 12m · Crédito transferido % · Impacto se exigir crédito integral (R$ e %) · `Semaphore` · Ação sugerida (chip: Renegociar / Manter / Atenção).
**Colunas (fornecedores):** CNPJ · Nome · Regime · % compras · Compras 12m · Crédito recuperado % · Crédito perdido/ano · Semáforo · Ação (Trocar / Renegociar / Manter).
**SideSheet ao clicar:** tabs *Resumo* (regime, fonte e data, editar regime manual com motivo), *Notas* (últimas 12 meses, link para XML via `storage-signed-url`), *Sensibilidade* (mini-simulação: "se este cliente exigir crédito integral, você fica X% mais caro; se trocar este fornecedor por um regular, recupera R$ Y/ano"), *Alertas* deste CNPJ.
**Filtros:** regime, semáforo, faixa de valor, busca. Export CSV. Ação em lote: "marcar para renegociar" (cria alerta info).
**Aceite:** 10 mil linhas fluidas; treemap e tabela sincronizados por seleção; edição manual de regime grava com motivo e aparece na auditoria.

---

## 3.4 T1 — Caixa do Imposto (home)

**Fonte:** RPC `dashboard_cash(tenant, 90)`, `mv_cash_timeline`, `alerts`, `credit_offers` (se fase 6).
**Layout:** linha 1: `HeroMetric` "Buraco líquido — próximos 30 dias" com sub "60d: R$ X · 90d: R$ Y" e trend; ao lado 4 `KpiCard`: Imposto retido no mês · Crédito a recuperar no mês · Crédito acumulado (dias médios) · Provisão sugerida. Linha 2: `CashTimelineChart` (12 semanas; barras semanais de saída/entrada + linha de saldo + banda de confiança); clique numa semana abre `SideSheet` com os eventos (nota, cliente, valor, data, confiança). Linha 3: cartão "Próximo aperto" (semana, valor, botão "Cobrir este buraco" → /credit com oferta pré-selecionada, ou "Ver provisão" se fase 6 ausente) + lista de 5 alertas mais recentes + cartão "Confiança da projeção" (banco conectado? histórico de recebimento? com CTAs).
**Comportamentos:** seletor de horizonte 30/60/90/120; toggle "com/sem financiamento contratado"; skeleton por bloco; auto-refresh ao concluir job `project_cash` (Realtime).
**Aceite:** carrega < 1 s com dado cacheado; soma dos eventos da semana bate com a barra; hero muda com o horizonte.

---

## 3.5 T4 — Regime (Simples tradicional × híbrido)

**Fonte:** `run_regime_simulation` (job) → `regime_simulations`; `storage-signed-url` para o PDF.
**Wizard 3 passos:** 1) *Confirmar carteira* (resumo B2B/B2C, % receita PJ regular, fornecedores por regime — links para T2 corrigir); 2) *Premissas* (margem, mix B2B/B2C, "trocar fornecedores do Simples por regulares?" toggle, crescimento, ano-base) com valores sugeridos a partir dos dados; 3) *Rodar* → `JobProgress` → resultado.
**Resultado:** `ComparisonCard` Tradicional × Híbrido com carga 2027 e 2033, crédito transferido a clientes, custo de conformidade, **recomendação com o número** ("Híbrido reduz a carga efetiva em 7,9% e preserva 68% da receita B2B"); gráfico de barras empilhadas 2027–2033; **contador regressivo** para a próxima janela (`next_window`), com aviso "o silêncio mantém o tradicional"; botões: "Gerar relatório para o contador" (PDF), "Compartilhar com o canal", histórico de simulações.
**Aceite:** simulação < 5 s; PDF abre; histórico lista com diff de premissas.

---

## 3.6 Painel do canal (channel)

**Fonte:** `channel_portfolio`, `tenants` (descendentes), `alerts` (escopo), `create_tenant`, `invite_user`, `regime_simulations`.
**/portfolio:** 4 KPIs (CNPJs ativos · buraco total 30d · empresas com janela de regime em < 60 dias · ofertas em aberto/comissão do mês); `DataTable` de empresas: Nome · CNPJ · plano · última ingestão (semáforo de saúde) · buraco 30/60/90 · urgência de regime · alertas críticos · ações (abrir, gerar relatório, atribuir analista). Ordenação padrão por buraco. Seleção em lote → "Gerar relatórios" (enfileira `regime_sim` para N) e "Convidar dono".
**/companies:** criar empresa (form CNPJ), convidar owner, ver status do onboarding de cada uma.
**/brand:** logo, cor primária, domínio (grava `tenants.brand`; preview ao vivo do shell).
**/commissions:** extrato mensal (fase 6), regras.
**Aceite:** channel vê só descendentes; white-label reflete em toda a árvore abaixo; ação em lote gera N jobs sem travar a UI.

> **MVP encerra aqui (3.1–3.6).**

---

## 3.7 T3 — Preço

**Fonte:** `products`, `price_scenarios`, `price_lines`, `enqueue_job(price_scenario)`, `approve_price_scenario`, `export_price_scenario`.
**Layout:** barra de cenário (seletor + "novo cenário" com margem alvo e ano fiscal + status draft/approved) · slider de ano 2027→2033 · toggle "Geral / Por cliente" (seletor de cliente com busca) · `DataTable` editável: SKU · Produto · NCM · Custo · Crédito na entrada · Preço atual · **Piso** · **Alvo** · Δ% · flag abaixo do piso. Edição inline de custo/preço atual (grava em `products`, reenfileira cálculo do cenário com debounce). Diff visual entre dois cenários. Rodapé: impacto agregado (receita, margem média, itens abaixo do piso). Botões: Aprovar (modal com resumo e confirmação; MFA se owner), Exportar CSV/ERP, Histórico.
**Aceite:** 5 mil linhas fluidas; aprovar arquiva o anterior; export importável no ERP.

---

## 3.8 T5 — Financiamento (fase 6)

**Fonte:** `credit_offers`, `accept_credit_offer`, `credit.contracts/ledger` (via RPCs), `tax_cash_events (loan_*)`.
**Layout:** cartões de oferta (`OfferCard`): Antecipar crédito acumulado (valor, deságio, prazo de retorno estimado) · Linha para o descasamento de [mês] (valor, prazo, custo total, CET) · Conta de provisão (rendimento). Cada um com "Ver detalhes" (breakdown, simulação do impacto no T1) e "Contratar" → drawer em 2 passos (revisar → assinar; exige MFA aal2 e papel owner/finance) → confirmação. Seção "Contratos": timeline de repagamento, `LedgerTable`, documentos. Toda tela mostra "impacto no seu caixa" atualizado.
**Aceite:** sem MFA não contrata; contrato aparece no T1 como `loan_in/loan_out`; auditoria completa.

---

## 3.9 Painel da plataforma (platform)

**/tenants:** já do 01 (árvore, criar, impersonar). **/plans:** CRUD. **/rules:** lista de `rule_versions`; "Nova versão" (calc_version, cclasstrib_version, valid_from, notas) → "Simular impacto" (`publish_rule_version(dry_run=true)` → cartão com delta amostral) → "Publicar" (confirmação dupla; enfileira reprocessamento; progresso global). **/ops:** `platform_ops_overview`: filas por serviço, jobs falhos com "reprocessar", saúde das integrações (Receita, SEFAZ, Open Finance, e-mail), tenants sem ingestão há > 7 dias. **/credit-admin (fase 6):** políticas, limites, carteira, inadimplência, aprovações manuais. **/audit:** global.
**Aceite:** publicar regra reprocessa e mostra diff; ops lista job falho com erro legível.

---

## 3.10 Alertas, notificações e relatórios

- `AlertBell` no topbar: contador de não lidos; lista agrupada por dia; clique navega ao contexto (nota, cliente, produto, T1 semana); ações lido/resolver com nota.
- Central `/alerts`: filtros por tipo/severidade/status; tipos: `regime_changed`, `inconsistent_item`, `below_floor`, `gap_over_limit`, `option_window`, `ingest_failed`, `bank_disconnected`.
- Preferências (settings): quais alertas por e-mail, limite de buraco para alerta crítico, dia do resumo semanal.
- Relatório semanal (Edge `weekly-digest`): e-mail com hero, 3 KPIs, top 3 alertas e link; layout dark-safe.
- Relatórios PDF (regime, carteira) via `storage-signed-url`.

---

## 3.11 Aceite global do front

1. Todo número monetário: mono, tabular, formatado BRL, sinal por cor só onde faz sentido (in/out).
2. Toda tela: skeleton, vazio, erro com retry, sem permissão.
3. Nenhuma query sem `tenant_id = activeTenantId` além da RLS; troca de tenant invalida cache do TanStack Query.
4. Nenhum `localStorage` de negócio; `last_tenant` vai para `profiles`.
5. Lighthouse ≥ 90 (perf/acess.) nas rotas T1 e T2 com 10 mil linhas.
6. Teclado: tabelas navegáveis, ⌘K funciona em qualquer rota, foco visível.
7. White-label do canal aplicado em toda a subárvore; banner de impersonação sempre visível.
8. Os 5 usuários do seed passam pela matriz do 01 §1.8 **e** pelas rotas acima sem ver dado fora do escopo.
