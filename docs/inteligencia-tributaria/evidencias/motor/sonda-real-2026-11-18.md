# Sonda real contra a Receita (18/11/2026)

Execução: GitHub Actions, run 44211469879 (branch `claude/project-thread-r25ha6`,
commit 9776a38), job `sonda`, sem banco e sem segredo. Artefato
`relatorio-sonda` (id 14386233518).

## Origem

- A raiz `https://arquivos.receitafederal.gov.br/` redireciona para o
  compartilhamento público `index.php/s/gn672Ad4CF8N6TK` (Nextcloud).
- As pastas antigas `/dados/cnpj/dados_abertos_cnpj/` e
  `/dados/cnpj/regime_tributario/` respondem 404.
- Competências do CNPJ publicadas (últimas 6): 2026-06 a **2026-11**.

## Medições (reais)

| Arquivo | Tamanho | Linhas | Tempo |
|---|---|---|---|
| Simples.zip (2026-11) | 299,2 MB | 51.328.896 | 351 s (≈ 0,85 MB/s) |
| entidades-lucro-real.zip | 10,6 MB | 1.846.953 | ≈ 13 s |
| entidades-lucro-presumido.zip (6 CSVs, 2019-2024) | 36,2 MB | 6.902.989 | ≈ 44 s |
| entidades-lucro-arbitrado.zip | 0,1 MB | 8.284 | ≈ 2 s |

Total: 362,8 MB baixados, 60.087.122 linhas varridas, 412 s (6,9 min de runner).
Layout conferido: Simples sem cabeçalho com `;`; regime com cabeçalho
`ano,cnpj,cnpj_da_scp,forma_de_tributacao,quantidade_de_escrituracoes`, separado
por vírgula. Nenhuma linha rejeitada.

Projeção não medida: Empresas + Estabelecimentos da competência somam ≈ 4,8 GB;
na velocidade observada, ≈ 95 min de download.

## Amostra pública (únicos CNPJs que podem aparecer no log)

| CNPJ | Simples (raiz) | ECF |
|---|---|---|
| 00.000.000/0001-91 (Banco do Brasil) | opção N; opção e exclusão em 01/07/2007 | Lucro Real 2016 a 2024 |
| 33.000.167/0001-01 (Petrobras) | raiz não consta no arquivo | Lucro Real 2016 a 2024 |
| 00.360.305/0001-04 (Caixa) | opção N; opção e exclusão em 01/07/2007 | Lucro Real 2016 a 2024 |
| 60.701.190/0001-04 (Itaú Unibanco) | raiz não consta no arquivo | Lucro Real 2016 a 2024 |

Pela regra da 0242, os quatro seriam `lucro_real` com base "ECF do ano-calendário
2024", com o aviso de que é histórico declarado e não o regime vigente.
