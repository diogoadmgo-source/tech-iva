# Zeros por falta em caminhos de dinheiro — 23/09/2026

Regra: ausente não é zero. Um `?? 0` só é aceitável se o banco nunca devolve
nulo naquele campo — ou se o zero que o banco devolve tem significado real
(soma de zero linhas quando a lista está completa, por exemplo).

Evidência levantada em 25/09/2026 no banco de produção (`lfufwoirpwlsdmststbr`),
só com consultas de leitura: definição atual das funções (`pg_get_functiondef`),
colunas (`information_schema.columns`), permissões
(`information_schema.role_routine_grants`), dependências (`pg_depend`) e
contagens. O banco de produção está quase vazio (1 empresa ativa, 0 notas,
0 contrapartes, 20 apurações e nenhuma `disponivel`), então a classificação se
apoia no **que o código do banco pode produzir**, não no que já produziu.

## Classificação

| # | Onde | Campo | Origem no banco | Pode ser nulo? (evidência) | Classificação | Ação |
|---|---|---|---|---|---|---|
| 1 | `alerts.ts:172` | `gap_critical_cents` | RPC `get_alert_prefs` → `alert_prefs_default() \|\| tenants.settings->'alerts'` | Não na prática. `alert_prefs_default()` sempre traz `500000`; `set_alert_prefs` grava `default \|\| antes \|\| novo`; a tela só envia número finito (`Number.isFinite`). Nulo só se alguém chamar a RPC à mão com `null` explícito. 0 tenants com o campo gravado. | Inofensivo | Nada. (Observação: nenhuma função do banco nem do app gera o alerta `gap_over_limit` que usa esse limite — ver "Achados fora da lista".) |
| 2 | `billing-history.server.ts:89` | `grand_total` → `amountCents` | Não é banco: API do Paddle (`/transactions`) | Sim. O tipo declara `details.totals.grand_total` opcional/nulo, e `Number(x ?? "0") \|\| 0` também transformava texto ilegível (`NaN`) em zero. Fatura sem total aparecia como R$ 0,00, igual a fatura gratuita. | **Mente** | **Corrigido** (commit `3c46916`): `centavosDoPaddle` (função pura com teste) devolve `null`; a tabela mostra "—". |
| 3 | `chain.ts:46` | `total_cents` | RPC `chain_map`: `coalesce(sum(i.total_cents),0)` em `left join invoices` dos últimos 365 dias | Não. `invoices.total_cents` é `NOT NULL`; a soma só é nula quando a contraparte não tem nota no período, e aí R$ 0,00 é o fato (não houve venda/compra). | Inofensivo | Nada. |
| 4 | `chain.ts:47` | `credit_lost_cents` | RPC `chain_map`: `(b_total * (100 - coalesce(b_ctp,0)) / 100)` | O campo nunca chega nulo (o `?? 0` do TypeScript é inofensivo), **mas o valor nasce de um zero-por-falta no banco**: `counterparties.credit_transfer_pct` é nulo exatamente quando o regime é desconhecido (`credit_pct_from_regime(...)` devolve `null` no `else`). O `coalesce(b_ctp,0)` trata "não sabemos quanto crédito passa" como "0% passa", e a tela mostra o total inteiro como crédito perdido / impacto. No mesmo registro, `chain.ts:44` (`credit_transfer_pct ?? 0`) mostra "0%" na coluna de crédito transferido. | **Mente — precisa decisão** | Não corrigido. Ver proposta abaixo: mexe no KPI "crédito perdido" da Carteira. |
| 5 | `commissions.ts:86` | `mrr_cents` (linha) | RPC `channel_commission_statement`: `coalesce(p.price_cents, 0)` em `left join subscriptions/plans` | `plans.price_cents` é `NOT NULL default 0`. Nulo só quando a empresa não tem assinatura; aí a linha mostra "sem assinatura" e não é faturável, e mensalidade R$ 0,00 é o fato (não há cobrança). | Inofensivo | Nada. |
| 6 | `commissions.ts:87` | `commission_cents` (linha) | Mesma RPC: `floor(coalesce(p.price_cents,0) * v_mrr_pct / 100)` | Mesmo raciocínio do 5; `v_mrr_pct` também é garantido (`coalesce(..., 20.00)`, padrão da plataforma, informado na resposta como `'padrão da plataforma'`). A tela já mostra 0 para linha não faturável por regra. | Inofensivo | Nada. |
| 7 | `commissions.ts:92` | `totals.mrr_cents` | Mesma RPC: `coalesce(sum(...),0)` sobre as linhas faturáveis | Soma de zero linhas faturáveis = 0, que é o fato. Nunca nulo. | Inofensivo | Nada. |
| 8 | `commissions.ts:93` | `totals.commission_cents` | Idem 7 | Idem 7. | Inofensivo | Nada. |
| 9 | `portfolio.ts:27` | `gap_30_cents` | RPC `channel_portfolio`: `coalesce(sum(tax_out/credit_in de tax_cash_events nos próximos 30 dias),0)` | Nunca nulo (`tax_cash_events.amount_cents` é `NOT NULL`), mas o zero tem **dois significados**: "a projeção rodou e não há saída de imposto" (fato) ou "a projeção nunca rodou para esta empresa" (não sabemos). Existe marcador: job `project_cash` com `status='done'` (hoje a única empresa ativa tem). A tabela e o KPI "buraco em 30 dias" somam o segundo caso como R$ 0,00. | **Mente (quando a empresa nunca foi projetada) — precisa decisão** | Não corrigido. Ver proposta abaixo: mexe no KPI da carteira do canal e na ordenação. |
| 10 | `portfolio.ts:28` | `gap_90_cents` | Idem 9, janela de 90 dias | Idem 9. | **Mente (idem 9) — precisa decisão** | Idem 9. |
| 11 | função do banco `apuracao_divergencia` | `coalesce(v_receita.debitos_cents, 0)` na diferença e no "divergente" | `rtc_apuracao.debitos_cents` (`bigint`, nulo, sem default) | Sim — **sempre**. Nenhuma rotina grava `debitos_cents`: nem `rtc_apuracao_ingest_json`, nem `rtc_apuracao_upsert`, nem o código do app (única função que cita a coluna é a própria `apuracao_divergencia`). Toda apuração `disponivel` mostraria "Débito apurado pela Receita R$ 0,00" (o `?? 0` da tela), divergência = nosso cálculo inteiro e "Calculamos mais do que a Receita apurou". | **Mente** | **Corrigido** (commit `edb8dec`): migração 0233 (diferença e veredito nulos sem o débito da Receita) + `compararApuracao` (função pura com teste) que garante o mesmo na tela antes de a migração ser aplicada. Falta decidir **qual** número da Receita comparar — ver abaixo. |
| 12 | colunas `invoices.cbs_cents`, `ibs_cents`, `is_cents`, `credit_cents` | `default 0` na tabela | Tabela `invoices` | Ver seção própria abaixo. | **Mente — precisa plano próprio** | Só classificação e proposta (sem migração). |
| — | `src/lib/error-page.ts` | — | — | É CSS dentro de uma string (não é dinheiro). | Falso positivo | Nada. |

Resumo: 6 inofensivos (1, 3, 5, 6, 7, 8), 2 mentiras corrigidas (2, 11), 3 mentiras
que precisam de decisão de produto (4, 9, 10) e o item 12, que é mudança de
modelo de dados e vira plano próprio.

## Consultas usadas (todas só de leitura)

- Definição das funções: `pg_get_functiondef` de `get_alert_prefs`,
  `alert_prefs_default`, `set_alert_prefs`, `chain_map`,
  `channel_commission_statement`, `channel_portfolio`, `apuracao_divergencia`,
  `apuracao_detalhe`, `rtc_apuracao_ingest_json`, `rtc_apuracao_upsert`,
  `credit_pct_from_regime`, `project_cash_sql`, `apply_calc_rules`,
  `ingest_invoices_batch`.
- Quem grava `debitos_cents`: busca em `pg_proc` por funções cujo corpo cita
  `debitos_cents` → só `apuracao_divergencia` (leitura). No código do app,
  `debitos_cents` só aparece em leitura (`src/lib/rtc.ts`).
- Quem grava `tax_cash_events`: `project_cash_sql` e `accept_credit_offer`.
- Quem cita `gap_critical`/`gap_over_limit` no banco: só `alert_prefs_default`.
- Colunas: `information_schema.columns` de `invoices`, `invoice_items`,
  `counterparties`, `plans`, `subscriptions`, `tax_cash_events`, `rtc_apuracao`.
- Permissões de `apuracao_divergencia`, `chain_map`, `channel_portfolio`:
  `authenticated`, `postgres` (dono), `service_role` — sem `anon` nem `PUBLIC`.
- Contagens: 20 apurações, 0 `disponivel`; 0 contrapartes; 0 notas; 0 itens;
  23 eventos de caixa em 1 empresa; 1 empresa ativa (já projetada); 0 tenants
  com `gap_critical_cents` gravado; 4 planos (1 com preço 0).
- Dependências das colunas de imposto de `invoices` em views (`pg_depend` +
  `pg_rewrite`): nenhuma.

## Propostas para os itens que precisam de decisão

### Item 4 — crédito perdido de contraparte com regime desconhecido

Hoje: regime desconhecido ⇒ `credit_transfer_pct` nulo ⇒ `chain_map` trata como
0% ⇒ "Crédito perdido/ano" (fornecedores) ou "Impacto crédito integral"
(clientes) = total inteiro, e a coluna de crédito transferido mostra "0%". O
número entra no KPI "crédito perdido" da Carteira (`summary.lost`) e na
"Sensibilidade" (`sensitivity()`).

Proposta:
1. Migração: em `chain_map`, `credit_lost_cents` passa a ser
   `case when b_ctp is null then null else ... end` (mesma lista de colunas:
   `create or replace`, sem drop; permissões `authenticated, service_role`).
2. TypeScript: `credit_transfer_pct` e `credit_lost_cents` viram
   `number | null`; célula mostra "—" e o texto "Classificar regime".
3. **Decisão de produto**: o KPI "crédito perdido" soma só as contrapartes com
   regime conhecido e diz "sem contar N contrapartes de regime desconhecido"?
   Ou o KPI fica "—" enquanto houver desconhecida relevante? Hoje o número é
   pessimista (supõe perda total), então mudar pode fazê-lo **cair** de uma vez —
   o usuário precisa entender por quê.

O que quebra: ordenação da tabela por essa coluna (nulos por último), a
Sensibilidade (precisa de um estado "não dá para estimar"), o texto
"X% do valor".

### Itens 9 e 10 — buraco de caixa de empresa nunca projetada

Hoje: empresa sem nenhum job `project_cash` concluído aparece com R$ 0,00 em 30
e 90 dias, entra como zero no KPI "buraco em 30 dias" da carteira do canal e
fica no meio da ordenação (`order by 6 asc`) como se estivesse saudável.

Proposta:
1. Migração: em `channel_portfolio`, `gap_30_cents` e `gap_90_cents` nulos
   quando `not exists (select 1 from jobs where tenant_id = t.id and kind =
   'project_cash' and status = 'done')`; `order by 6 asc nulls last`.
2. TypeScript: `number | null`, célula "—" com dica "projeção ainda não rodou".
3. **Decisão de produto**: o KPI da carteira soma só as empresas projetadas e
   informa quantas ficaram de fora? A mesma pergunta vale para o painel de caixa
   de cada empresa (`dashboard_cash`, não auditado aqui — ver abaixo).

### Item 11 — qual débito da Receita entra na comparação

A correção feita tira a mentira, mas o quadro "Receita × nosso cálculo" passa a
mostrar **sempre** "—", porque `debitos_cents` nunca é gravado. Os números que a
Receita de fato manda estão em `rtc_apuracao.resultado_cents` (soma de
`cbs_total_cents` do grupo `corrente` em `rtc_debito`, gravada por
`rtc_apuracao_ingest_json`) e no próprio `rtc_debito` (por nota, incluindo
`ajuste` e `extemporaneo`).

**Decisão de produto**: comparar com `resultado_cents` (só apuração corrente)?
Com a soma de todos os grupos? E o nosso lado (soma de `invoices.cbs_cents` das
notas de saída emitidas no mês) é o recorte certo contra isso? Até decidir, a
conferência nota a nota (conciliação) continua sendo a comparação que vale.

## Item 12 — `default 0` nas colunas de imposto de `invoices`

### Evidência

| Coluna | Tipo | Nulo? | Default |
|---|---|---|---|
| `invoices.cbs_cents` | bigint | sim | `0` |
| `invoices.ibs_cents` | bigint | sim | `0` |
| `invoices.is_cents` | bigint | sim | `0` |
| `invoices.credit_cents` | bigint | sim | `0` |
| `invoice_items.cbs_cents` / `ibs_cents` / `is_cents` / `credit_cents` | bigint | sim | **sem default** |
| `invoice_items.calc_memory` | jsonb | sim | sem default |
| `invoices.rule_version_id` | uuid | sim | sem default |

Como os valores nascem, lendo as funções atuais:

- `ingest_invoices_batch` insere a nota **sem** as colunas de imposto ⇒ nota
  nova fica com 0 em todas, igual a uma nota isenta.
- `apply_calc_rules` calcula item a item só quando acha regra em
  `calc_rule_cache` e a nota é de 01/01/2026 em diante; item calculado ganha
  `calc_memory` com `rule_version`. Depois, **para toda nota do tenant que tem
  itens**, grava `cbs_cents = sum(itens.cbs_cents)` e
  `rule_version_id = coalesce(v_rule_id, rule_version_id)`. Consequências:
  - nenhum item calculado ⇒ `sum` de nulos = **nulo** (a nota sai do 0 para
    nulo — esse caso já é honesto);
  - parte dos itens calculada ⇒ `sum` ignora os nulos ⇒ **total parcial** que
    parece completo (mentira que o `default 0` nem explica);
  - nota sem itens ⇒ nunca é tocada ⇒ **fica 0**.
- Reingestão (`on conflict do update`) não zera nem recalcula os totais.

### Qual marcador distingue "calculada" de "não calculada"

- `invoices.rule_version_id`: **desqualificado**. `apply_calc_rules` grava em
  toda nota com itens, calculada ou não (e mantém o antigo quando a versão não
  existe).
- `invoice_items.calc_memory`: **confiável por item**. Só é preenchido quando o
  item foi de fato calculado, e carrega a versão da regra
  (`calc_memory->>'rule_version'`).
- Regra proposta: **nota calculada ⇔ tem ao menos um item e todos os itens têm
  `calc_memory` não nulo** (para a versão vigente, se quisermos exigir
  recálculo após troca de regra).

### Opções de correção (cada uma com o que quebra)

1. **Tirar o default e marcar como nulo o que não foi calculado** (`alter
   column ... drop default` + backfill `null` nas notas sem todos os itens
   calculados). Quebra quem lê essas colunas supondo número. Funções do banco
   que leem `invoices` e alguma dessas colunas (busca em `pg_proc`):
   `project_cash_sql` (conferido: `i.ibs_cents + i.cbs_cents` vira nulo e a nota
   some da projeção em silêncio; o run-rate `sum(...)` ignora nulos e fica
   menor), `apuracao_divergencia` (conferido: soma fica parcial), `chain_map`,
   `counterparty_detail`, `comparar_modalidades`, `ganho_antecipacao`,
   `regime_wallet_summary`, além das duas de conciliação (que já tratam nulo
   depois da 0232). Nenhuma view depende delas. Cada leitor precisaria dizer
   "N notas sem cálculo" em vez de somar calado.
2. **Manter as colunas e usar o marcador na leitura** (função
   `invoice_calculada(id)` ou coluna gerada/derivada a partir de
   `invoice_items.calc_memory`). Não quebra nada que existe, mas cada leitor
   tem de passar a usar o marcador; quem esquecer continua lendo 0.
3. **Corrigir a origem em `apply_calc_rules`**: gravar total da nota só quando
   todos os itens foram calculados (senão `null`), e tirar o default. Resolve o
   total parcial e o 0 da nota nova, mas herda as quebras da opção 1.

Recomendação: **3 com o marcador da opção 2 como definição**, num plano
próprio que (a) altere `apply_calc_rules`, (b) tire o default, (c) faça o
backfill, e (d) revise, uma a uma, as funções acima para não somar nulo
em silêncio. A conciliação da Tarefa 5 (migração 0232) já sabe mostrar "Nossa
nota ainda não foi calculada" quando `cbs_cents` é nulo — só passará a mostrar
quando o banco entregar nulo.

## Achados fora da lista (não corrigidos, para a próxima rodada)

- `src/components/techiva/billing-history.tsx:313` — `Number(ev.amount) || 0`
  no evento de assinatura. Protegido por `ev.amount ?` antes, então só texto
  ilegível vira R$ 0,00. Mesmo padrão do item 2, risco baixo.
- Painel de caixa de cada empresa: `apuracao.tsx` (`hero.gap_30_cents ?? 0`,
  `gap_90_cents ?? 0`), `finance.tsx` (`hero?.gap_30_cents ?? 0`) e o objeto
  vazio `EMPTY` com `hero: { gap_30_cents: 0, ... }` em `src/lib/cash.ts`. Mesma dúvida dos itens
  9 e 10 ("nunca projetada" vira zero); não auditado.
- `apuracao_divergencia.nosso_debito_cents` = `coalesce(sum(cbs_cents),0)`:
  inofensivo por si (soma de zero notas = 0), mas herda o item 12.
- Limite `gap_critical_cents` (item 1): nenhuma rotina gera o alerta
  `gap_over_limit`; o limite é gravado e não é usado.
