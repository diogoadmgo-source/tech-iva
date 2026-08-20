# Apuração da CBS — redesenho estrutural

## Resposta: o que o `rtc_apuracao` grava hoje

**Grava o JSON bruto completo, sim** — e em dois níveis:

1. `rtc_apuracao.payload` (jsonb) recebe a resposta **integral** do download. No fluxo de download (`src/lib/rtc-apuracao.server.ts`), o `payload` é gravado **antes** da ingestão, logo após a resposta da Receita, junto com `download_em`; em seguida `tiquete_download` é zerado (uso único). Reprocessar usa o `payload` guardado e **não** consome tíquete nem cota: o código só chama a Receita quando `payload` é nulo.
2. `rtc_debito` guarda uma linha por documento com os campos já normalizados (`chave_dfe`, `cbs_total_cents`, `cbs_extinto_cents`, `cbs_nao_extinto_cents`, `situacao`, `grupo`, somas por forma de extinção, `tipos_pagamento[]`) **e** o `payload` jsonb do débito individual — inclusive o bloco `formasExtincao` completo.

Ou seja, nada do JSON é descartado: os campos agregados são derivados, não substitutos. Nenhuma competência baixada com sucesso precisa de nova consulta para o redesenho.

Ressalva do estado atual: hoje **não há nenhuma apuração com `payload` gravado** — as últimas cinco tentativas da GDB estão em `status = 'erro'` (falhas de token/rate limit já tratadas), então não houve download bem-sucedido ainda. A estrutura está pronta; falta um download que conclua.

## Plano em blocos

### Bloco 0 — Fazer uma consulta concluir (pré-requisito, antes de qualquer UI)
Nenhum payload real existe ainda, então o schema nunca foi confrontado com a resposta da Receita. Nada de UI antes disto.
- Limpar `RTC_APURACAO_URL` (hoje contém `077057`, não é URL) e declarar explicitamente `RTC_API_URL`, `RTC_TOKEN_URL` e `RTC_API_PREFIX` do ambiente em uso, para o endereço deixar de vir de fallback.
- **Token do download (premissa corrigida):** o manual só exige `Bearer <token válido>`; não vincula o tíquete ao token da solicitação. Como o token de `client_credentials` expira em ~1h e o fluxo é assíncrono, o token guardado pode estar vencido quando o webhook chega — o que explica o padrão 401 → nova tentativa → rate limit. Regra nova: **se o `access_token_ref` estiver ausente OU o download devolver 401/403, obter token novo e tentar UMA vez**; o download não consome cota de solicitação. O caminho usado (`guardado` ou `novo`) fica registrado em log e no banco, para sabermos se a premissa era verdadeira.
- **Captura completa da resposta do download:** gravar `status` HTTP, headers relevantes (`content-type`, `x-request-id`, `x-ratelimit-*`, `retry-after`, `www-authenticate`, `date`), o caminho de token usado e, em caso de erro, um recorte do corpo — não só o JSON de sucesso. Se falhar de novo, o motivo aparece sem gastar outra consulta.
- Com a cota reaberta (0 restantes hoje), rodar UMA solicitação, capturar o payload bruto e conferir o JSON campo a campo contra o `rtc_apuracao_ingest_json`: nomes, tipos, `formasExtincao` como objeto vs array, `chaveDfe` como string (o caso `chNFe` virando número já nos custou uma rodada), escala dos valores e vocabulário de `situacaoDebito`.
- Só depois: revisar os blocos 1 a 6 contra o JSON recebido, não contra o manual.

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
- **Acrescentar** ao `PageHeader` a data/hora da última consulta e as chamadas restantes do dia. Com 2 consultas por dia, é informação crítica para o usuário decidir se gasta uma.
- Remover do layout o que o novo desenho torna redundante (blocos de total agregado que viram KPI), mantendo o painel de documentos de saída da competência sempre visível e os avisos dinâmicos de `platform_notices`.

### Bloco 6 — Verificação
- Conferir a tela com uma apuração ingerida a partir de `payload` já gravado (reprocessamento local, sem consumir cota), build e typecheck.

## Detalhe técnico
Todo o cálculo de somas e classificação fica em RPC `security definer` com escopo por tenant (o front não soma nem filtra), mantendo o padrão de paginação no servidor e a regra de nunca exibir valor fiscal que não venha do dado oficial persistido.
