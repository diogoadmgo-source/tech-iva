# Inteligência Tributária: evidências da Fase 1

Execuções reais de 17/11/2026, no ambiente de desenvolvimento (Linux, 4 vCPU,
PostgreSQL 16.15 local, Node 22). As saídas completas, sem edição, estão em `evidencias/`.
Nada foi executado no Supabase: **as migrations 0240 e 0241 não foram aplicadas**.

Os dados de teste são sintéticos: tenants e usuários fictícios e CNPJs gerados com DV
calculado. Eles servem para testar regras e desempenho do banco e não representam consulta
real a nenhuma fonte. Nenhuma API externa foi chamada.

## 1. Resumo

| Verificação | Resultado | Saída |
| --- | --- | --- |
| Suíte SQL (Postgres descartável) | **252 testes, 252 PASS, 0 FAIL** | `evidencias/suite-sql-2026-11-17.txt` |
| Testes unitários do módulo (vitest) | **28 testes, 28 PASS** | `evidencias/vitest-2026-11-17.txt` |
| Suíte vitest completa do projeto | **157 testes, 157 PASS** (eram 129 antes do módulo) | idem |
| `tsc --noEmit` | sem erros | — |
| `bun install --frozen-lockfile` (cópia limpa) | 620 pacotes, lockfile aceito | — |
| Guarda de estilo (`scripts/visual-guard`) | 2 de 2 PASS | — |

## 2. Suíte SQL por bloco

| Bloco | Arquivo | Testes | O que prova |
| --- | --- | --- | --- |
| cnpj | `10_cnpj.sql` | 26 | DV numérico e alfanumérico (exemplo oficial 12ABC34501DE35), colunas derivadas (raiz, ordem, matriz), **SQL e TypeScript concordam em 20.010 casos** gerados |
| importacao | `20_import.sql` | 60 | validação, normalização, zeros à esquerda, repetição no arquivo, "já existia", idempotência, retomada de 1.200 linhas, cancelamento, entradas inválidas |
| isolamento | `30_isolation.sql` | 43 | tenant B não vê nada de A (nem pelo cache público), hierarquia canal → empresa → unidade, plataforma, anon sem acesso, usuário sem vínculo, **escopo das políticas = `in_scope()` para os 13 usuários** |
| papeis | `40_roles.sql` | 36 | matriz dos 9 papéis (importar e ler log), leitura só para os demais, importação só em empresa ou unidade, nenhum INSERT/UPDATE/DELETE direto |
| documentos | `50_storage.sql` | 28 | buckets privados, upload só no caminho gerado e por quem criou, `../` recusado, viewer e outra empresa não baixam, arquivo sem evidência registrada não é baixável |
| imutabilidade_auditoria | `60_immutability_audit.sql` | 29 | UPDATE, DELETE e TRUNCATE barrados até para o superusuário, evidência só ativa → revogada, **IBS e CBS independentes**, log com autor e papel |
| separacao_catalogo | `70_separation.sql` | 17 | nenhuma coluna de tenant no plano público, nenhuma FK público → privado, RLS nas 16 tabelas, grants mínimos, `search_path` fixo com `pg_temp` em toda security definer |
| carga | `80_load.sql` | 13 | 70 mil linhas pelo mesmo RPC da tela, contagens exatas, finalização em trechos |

## 3. Carga de 70 mil linhas

Base gerada em `80_load.sql`. Em cada 100 linhas: 1 CNPJ com DV errado e 1 repetição da
linha anterior. Uma em cada 5 é filial. Tudo foi enviado em lotes de 1.000 como owner da
Empresa A, com RLS e papéis reais. Tempos da última execução (o arquivo de saída traz os
mesmos números):

| Etapa | Tempo |
| --- | --- |
| `tax_import_create` | 6,3 ms |
| 70 lotes de 1.000 (`tax_import_add_items`) | 10,6 s no total, pior lote 221 ms |
| reenvio de um lote já recebido (retomada) | 125 ms, 0 linhas inseridas |
| `tax_import_finalize`, 7 chamadas de até 10 mil linhas | 7,3 s no total, **pior chamada 1,17 s** |
| total do banco | 19,5 s |
| ler com RLS: contar 69.809 relacionamentos (owner de A) | 18,6 ms |
| ler com RLS: contar 69.807 entidades públicas visíveis (owner de A) | 237 ms |
| ler com RLS: página de 50 linhas no offset 30.000 | 20,7 ms |
| ler com RLS: plataforma contando relacionamentos | 14,5 ms |
| ler com RLS: empresa B contando entidades (vê 2) | 112 ms |

Contagens conferidas: 700 CNPJs inválidos, 699 repetições, 68.601 válidos. Toda linha
terminou com situação final. A primeira chamada deixa a importação "finalizando", e nesse
estado ela não pode ser cancelada.

Leitura e prévia no navegador (Node, vitest):

| Arquivo | Tempo |
| --- | --- |
| CSV de 70 mil linhas | 428 ms (leitura + prévia) |
| XLSX de 70 mil linhas (1,5 MB, CNPJ em célula numérica) | 1.528 ms (leitura + prévia) |

## 4. Problemas encontrados pelos testes e corrigidos

1. **RLS avaliado por linha.** Antes, a política `in_scope(tenant_id)` levava 7.335 ms para
   contar 69.809 relacionamentos (plano medido com `auto_explain`). Depois, com
   `tax_scope_tenants()` calculado uma vez por consulta, a mesma contagem leva 12,7 a
   18,6 ms. O critério de escopo é o mesmo, e um teste compara os dois para cada usuário.
2. **Finalização numa chamada só.** Antes da mudança, a primeira medição foi de 6,9 s.
   Numa execução seguinte, chegou a 140,9 s por plano ruim (tabela temporária sem
   estatística). O `statement_timeout` padrão do papel `authenticated` no Supabase é de 8 s.
   Agora a finalização roda em trechos de 10 mil linhas, com `analyze` na tabela temporária
   e índice `(import_id, cnpj, row_number)`, e a pior chamada fica em 1,17 s.

## 5. O que estes testes não cobrem

* Não houve execução no Supabase. O tempo real lá depende do tamanho da instância. A
  margem é de 1,2 s contra 8 s por chamada medida aqui.
* A tela não foi aberta num navegador contra o banco real, porque as tabelas ainda não
  existem no projeto. Tipos e build de rotas foram verificados com `tsc`.
* A suíte SQL roda contra stubs do Supabase (`00_supabase_stubs.sql`). As funções de
  escopo são cópia literal das do banco em uso. Já o Storage é simulado: tabelas e
  políticas reais, sem o serviço HTTP.
* Os 500 CNPJs reais do piloto ficam para a Fase 4, como combinado.

## 6. Como reproduzir

```bash
# Postgres 16 descartável (nunca o Supabase; o script recusa host *.supabase*)
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres ./scripts/tax-intel/sql-tests.sh
# carga menor para iterar rápido
TAX_LOAD_ROWS=2500 PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres ./scripts/tax-intel/sql-tests.sh

bunx tsc --noEmit
bunx vitest run
```

No GitHub, o workflow `Inteligência Tributária · SQL` roda a mesma suíte em todo PR que
toque nas migrations 024x, nos testes ou no script.
