# Apuração da CBS — redesenho estrutural

## Resposta: o que o `rtc_apuracao` grava hoje

**Grava o JSON bruto completo, sim** — e em dois níveis:

1. `rtc_apuracao.payload` (jsonb) recebe a resposta **integral** do download. No fluxo de download (`src/lib/rtc-apuracao.server.ts`), o `payload` é gravado **antes** da ingestão, logo após a resposta da Receita, junto com `download_em`; em seguida `tiquete_download` é zerado (uso único). Reprocessar usa o `payload` guardado e **não** consome tíquete nem cota: o código só chama a Receita quando `payload` é nulo.
2. `rtc_debito` guarda uma linha por documento com os campos já normalizados (`chave_dfe`, `cbs_total_cents`, `cbs_extinto_cents`, `cbs_nao_extinto_cents`, `situacao`, `grupo`, somas por forma de extinção, `tipos_pagamento[]`) **e** o `payload` jsonb do débito individual — inclusive o bloco `formasExtincao` completo.

Ou seja, nada do JSON é descartado: os campos agregados são derivados, não substitutos. Nenhuma competência baixada com sucesso precisa de nova consulta para o redesenho.

Ressalva do estado atual: hoje **não há nenhuma apuração com `payload` gravado** — as últimas cinco tentativas da GDB estão em `status = 'erro'` (falhas de token/rate limit já tratadas), então não houve download bem-sucedido ainda. A estrutura está pronta; falta um download que conclua.

## Plano em blocos

### Bloco 1 — Leitura (banco, sem consumir cota)
- RPC de resumo por grupo (`corrente` / `ajuste` / `extemporaneo`): soma de `cbs_total`, `cbs_extinto`, `cbs_nao_extinto` e a parcela do extinto cujo `tipos_pagamento` contém `split`.
- RPC de lista de débitos paginada por grupo (ORDER BY com desempate por id, count separado, busca por `chave_dfe`/número), devolvendo `formasExtincao` do `payload` do débito para o expandir.
- Confirmar/ajustar índices casados (`apuracao_id, grupo, id`) e o índice de busca por chave.

### Bloco 2 — Conciliação nota a nota
- RPC que casa `rtc_debito.chave_dfe` com as notas ingeridas (`invoices`) e classifica cada linha em quatro estados: **bate**, **diverge no valor**, **só na Receita**, **só na nossa base**. Paginada no servidor, com filtro por estado.

### Bloco 3 — Estrutura da tela
- `Segmented` com três seções: Competência corrente, Em ajuste, Extemporâneos — cada uma com seus próprios totais e lista.
- Herói (`panel-hero`): **`valorCBSNaoExtinto` somado** do grupo selecionado — só renderiza quando há débitos com número real (regra já aplicada em /price e /cash).
- KPIs: débito total, extinto, e extinto por split. Sem repetir o número do herói.

### Bloco 4 — Tabela de débitos + expandir
- Tabela no padrão do design system (`th-label`, `row-hover`, `num`, `font-mono tabular` para chave/número), `Semaforo` na classificação da conciliação e chip para `situacaoDebito`.
- Linha expansível mostrando as formas de extinção daquele débito: créditos de CBS, créditos de PIS/COFINS, DARFs com `tipoPagamento`, prescrição — cada uma com valor e identificação.
- `EmptyState` quando o grupo não tem débitos.

### Bloco 5 — PageHeader e limpeza
- Remover do `PageHeader` a data/hora da última consulta e as chamadas restantes do dia.
- Remover do layout o que o novo desenho torna redundante (blocos de total agregado que viram KPI), mantendo o painel de documentos de saída da competência sempre visível e os avisos dinâmicos de `platform_notices`.

### Bloco 6 — Verificação
- Conferir a tela com uma apuração ingerida a partir de `payload` já gravado (reprocessamento local, sem consumir cota), build e typecheck.

## Detalhe técnico
Todo o cálculo de somas e classificação fica em RPC `security definer` com escopo por tenant (o front não soma nem filtra), mantendo o padrão de paginação no servidor e a regra de nunca exibir valor fiscal que não venha do dado oficial persistido.
