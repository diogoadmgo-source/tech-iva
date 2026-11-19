# Apuração da CBS v2: débitos, recolhimentos e DARF (19/11/2026)

Tela: **Caixa do imposto → DARF e recolhimentos** (`/t/$tenantId/recolhimentos`).
Migration: `0260_cbs_v2_darf_recolhimentos`. Suíte SQL: `scripts/rtc-v2/sql-tests.sh`.

## Fluxo assíncrono (débitos, pagamentos, recolhimentos)

Conforme o guia das APIs assíncronas (versão 1.1, de 14/10/2026):

1. `POST /apuracao-cbs/v2/{recurso}/{cnpj8}` com `urlRetorno`. O retorno é 201 com `tiqueteSolicitacao` e `tEASegundos`.
2. O webhook manda só `{tiqueteSolicitacao, situacao}`, sem link. Também dá para consultar `GET /v2/situacao/{tiquete}`, que traz o campo **`situacao`**.
3. Com `CONCLUIDA`, o app pede `GET /v2/download/{tiquete}` (com Bearer), que devolve `urlAssinada`.
4. O app baixa por `GET` na `urlAssinada`, **sem** Bearer e sem cabeçalhos.

O limite é de **4 aberturas por dia em cada API**, por credencial, e a cota reinicia à meia-noite de Brasília. A contagem fica em `rtc_api_quota_v2`.
A janela é incremental (últimos 8 dias), então as linhas são gravadas por upsert:
- débitos em `rtc_cbs_debito_v2`, pela chave pa + chave + origem;
- pagamentos e recolhimentos em `rtc_cbs_pagamento`, pela chave número do DARF + sequencial.

Créditos têm estrutura própria (apropriação e utilização) e ainda não têm leitor. O arquivo fica guardado em `rtc_apuracao.payload`.

## DARF (síncrono)

- **PCONT**, pagamento pela própria empresa: `POST /v2/pcont/{cnpj}` com `{pa:"MM/AAAA", opcaoPagamento, valorDarfParcial?}`.
- **RAD**, como adquirente: `POST /v2/rad/{cnpj}` com `[{chaveDFE, opcaoPagamento, valorDarfParcial?}]`.
- A resposta traz `cdRetorno`, `darf{chavePIX, codigoBarras, linkDarfPDF}` e `informacoesPagamento{dataMaximaPagamento, valores}`.
- Toda emissão, inclusive as recusadas, fica em `rtc_cbs_darf` e na auditoria (`darf.gerar`).
- Podem gerar DARF: dono, financeiro e administradores (`rtc_pode_emitir_darf`).

## Pontos a confirmar na primeira chamada real

- **CNPJ no caminho do DARF.** A tabela da documentação diz 14 dígitos e um exemplo do RAD usa 8. Enviamos 14 (`urlDarf`).
- **RAD com várias notas.** A documentação mostra um objeto de resposta só. O leitor aceita objeto ou lista (`lerRespostaDarf`).
- **`linkDarfPDF`.** Não está documentado se exige Bearer. O app baixa pelo servidor com o Bearer, só de domínios da Receita.
