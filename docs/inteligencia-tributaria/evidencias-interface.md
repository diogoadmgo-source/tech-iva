# Evidências da interface — 17/11/2026

Ambiente: Supabase **local** (CLI 2.122.1, Postgres 17) com as migrations 0240 e 0241 aplicadas
só nele, e o app em `vite dev`. **O fluxa-dev não foi tocado.**

Os dados são uma base **sintética de teste** gerada por `scripts/tax-intel/e2e/gen.mjs`. Os CNPJs
têm dígitos verificadores válidos, os nomes são "Empresa Teste NNNNN" e os erros são colocados de
propósito: DV errado, CNPJ vazio, tipo vazio, linhas repetidas, CNPJ alfanumérico e zeros à
esquerda perdidos. Essa base serve só para testar a interface e nunca deve ir para produção.

Nenhuma consulta a fonte pública foi simulada. Todos os CNPJs aparecem como "Consulta pendente",
porque as integrações entram na Etapa 3.

## Telas (pasta `evidencias/interface/`)

| Tela | Arquivo |
| --- | --- |
| Painel vazio (primeiros passos) | `01-painel-vazio.jpg` |
| Importação: arrastar e soltar | `02-importacao-arquivo.jpg` |
| Pré-validação: colunas reconhecidas, qualidade, inconsistências | `03-importacao-validacao.jpg` |
| Processamento: etapas, %, linhas/s, tempo restante | `04-processamento.jpg` |
| Resultado | `05-resultado.jpg` |
| Detalhe da importação, linha a linha | `06-detalhe-importacao.jpg` |
| Carteira, busca, filtros, seleção em lote | `07` a `10` |
| Detalhe do CNPJ (resumo e consultas) | `11`, `12` |
| Painel executivo preenchido | `13-painel.jpg` |
| Histórico de importações | `14-historico.jpg` |
| Tablet (820 px) e celular (390 px) | `15-*` |
| Escala: 70 mil linhas | `20` a `24` |

## Fluxo funcional (`scripts/tax-intel/e2e/flow.cjs`, Playwright)

A base tem 5.055 linhas. Os números da tela foram conferidos com SQL direto no banco local
(`conferencia-sql.txt`):

| Conferência | Tela | Banco |
| --- | --- | --- |
| CNPJs distintos | 4.357 | 4.357 |
| Clientes / fornecedores | 3.391 / 974 | 3.391 / 974 |
| Matrizes | 1.442 | 1.442 |
| Alfanuméricos | 6 | 6 |
| Busca "90.000.01" (CNPJ parcial com máscara) | 30 | 30 |
| Busca "Teste 0042" (nome) | 8 | 8 |
| Fornecedores alfanuméricos | 6 | 6 |
| Excel da carteira inteira | 4.365 linhas | 4.365 |
| Excel da seleção (1 página) | 50 linhas | 50 |

Outros resultados:
* Não houve estouro horizontal em 1440, 820 e 390 px nas três telas.
* No console, o único erro foi o 404 do logotipo hospedado no Lovable (`/__l5e/assets-v1/.../techiva-logo.png`). Ele não está disponível no ambiente local e não vem do módulo.

## Escala (`scale.cjs` e `api.sh`)

Uma segunda importação de 70.055 linhas foi feita pela interface, por cima da primeira. A
carteira ficou com 60.656 relacionamentos e 60.648 CNPJs.

| Operação | Tempo |
| --- | --- |
| Leitura e validação da planilha no navegador | 1,9 s |
| Importação completa: envio, validação no banco e gravação | 21,9 s |
| Painel com 17 contagens no banco | 1,2 s |
| Primeira página da carteira | 0,5 s |
| API: página padrão com contagem exata | 0,46 s |
| API: busca por CNPJ | 0,05 s |
| API: busca por nome | 0,14 s |
| API: filtro tipo + classificação | 0,18 s |
| API: ordenação pela classificação (tabela ligada) | 0,43 s |
| Exportação Excel de 60.656 linhas (61 páginas de 1.000) | 37,9 s |

Os tempos são da máquina de testes, com banco local. Em produção, a latência de rede soma a cada
chamada.

## Verificações de código

* `tsc --noEmit`: sem erros.
* `eslint` nos arquivos do módulo: sem erros.
* `vitest`: 157/157, incluindo a guarda de separação da regra antiga de regime e a guarda de texto solto.
* `vite build`: concluído.

## Reversão

Os arquivos novos são estes, e removê-los desfaz a interface sem afetar o banco:
* `src/routes/_authenticated/t.$tenantId.tributario.index.tsx`
* `src/routes/_authenticated/t.$tenantId.tributario.carteira.tsx`
* `src/components/tax-intel/*`
* `src/lib/tax-intel/{labels,portfolio,excel}.ts`

Além disso:
* A tela de importações foi reescrita; `git revert` do commit volta à versão anterior.
* `tenant-nav.ts` ganhou dois itens.
* `tenant-sidebar.tsx` passou a marcar o "Painel" do módulo como ativo só na rota exata.
