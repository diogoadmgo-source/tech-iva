# Inteligência Tributária: arquitetura (Fase 1)

Status em 17/11/2026: código e migrations no branch `claude/project-thread-r25ha6`.
**As migrations 0240 e 0241 NÃO foram aplicadas no Supabase.** Só serão aplicadas com
autorização expressa do responsável. Todos os testes desta fase rodam num Postgres 16
descartável (local ou no CI).

Especificação revisada (v2): https://claude.ai/artifact/M6jaqjeFdRe66jn2KpreWF.
Este documento registra o que a Fase 1 entrega e incorpora os 4 ajustes pedidos na aprovação
da v2.

## 1. O que a Fase 1 entrega

| Peça | Arquivo |
| --- | --- |
| Esquema, RLS, imutabilidade, buckets | `supabase/migrations/20261117200000_0240_inteligencia_tributaria_fundacao.sql` |
| RPCs de importação | `supabase/migrations/20261117200100_0241_inteligencia_tributaria_importacao.sql` |
| CNPJ numérico e alfanumérico (TS) | `src/lib/tax-intel/cnpj.ts` |
| Leitura XLSX/CSV, zip-bomb | `src/lib/tax-intel/read-file.ts`, `zip-guard.ts` |
| Prévia no navegador | `src/lib/tax-intel/preview.ts` |
| Cliente da importação (lotes, retomada) | `src/lib/tax-intel/import-client.ts` |
| Tela | `src/routes/_authenticated/t.$tenantId.tributario.importacoes.tsx` |
| Menu | grupo "Inteligência Tributária" em `src/lib/tenant-nav.ts` (empresa e unidade) |
| Suíte SQL | `db/tests/tax_intel/*.sql`, `scripts/tax-intel/sql-tests.sh` |
| CI da suíte SQL | `.github/workflows/tax-intel-sql.yml` |

Fora desta fase: consulta a fontes (Fase 2), classificação e painel (Fase 3), exportação
Excel e piloto com 500 CNPJs reais (Fase 4). Nenhuma fonte externa é chamada nesta fase, e
nenhum regime é calculado ou presumido.

## 2. Planos de dados

**Público, global, sem `tenant_id`**: `tax_sources`, `tax_entities`, `tax_consultations`,
`tax_regimes`, `tax_regime_history`, `tax_regime_events`. Guarda só o que vem de fonte
pública. Um CNPJ público só é visível para quem tem esse CNPJ (ou a raiz) na carteira de um
tenant do seu escopo.

**Privado, por tenant (`tenant_id NOT NULL`)**: `tax_imports`, `tax_import_items`,
`tax_relationships`, `tax_evidences`, `tax_tenant_classifications`,
`tax_processing_jobs`, `tax_job_items`, `tax_audit_logs`.

**Operacional, só gestores da plataforma**: `tax_source_runs`, `tax_source_run_files`.

Regras verificadas por teste (`70_separation.sql`):

* nenhuma tabela pública tem coluna de tenant;
* nenhuma FK sai do plano público para o privado;
* evidência de tenant nunca vira fonte: `tax_sources` só aceita `is_public = true` e recusa
  código com "evidencia";
* o nome declarado por um tenant fica em `tax_relationships`, nunca em `tax_entities`.

## 3. Importação

Fluxo (até 100 mil linhas; meta de aceite 70 mil):

1. **Navegador**: o arquivo é lido localmente (exceljs para XLSX, papaparse para CSV). O
   CNPJ é sempre texto. A prévia aplica as mesmas regras do banco.
2. `tax_import_create`: valida papel, tipo de tenant (empresa ou unidade) e entradas, e
   devolve o caminho do arquivo no Storage (`<tenant>/<import>/<nome>`), gerado pelo banco.
3. O original sobe no bucket privado `tax-imports`. A política só aceita aquele caminho,
   enviado por quem criou a importação, enquanto ela está "recebendo".
4. `tax_import_add_items`: lotes de até 1.000 linhas e 2 MB. O banco revalida tudo, recusa
   chaves desconhecidas e é idempotente por `(import_id, row_number)`.
5. `tax_import_finalize`: deduplica, separa "já existia" de "novo", cria entidades e
   relacionamentos. Processa **até 10 mil linhas por chamada**, e o cliente repete até
   `done = true` (ver 3.1).

Normalização: zeros à esquerda só são completados quando o valor é todo numérico com 12 ou
13 dígitos, e a linha registra `zeros à esquerda completados`. Valor alfanumérico nunca é
completado.

Situação de cada linha: `valido`, `ja_existente`, `duplicado_no_arquivo`, `cnpj_invalido`,
`cnpj_ausente`, `relacionamento_invalido`. Linha repetida é a que tem o mesmo par
(CNPJ, relacionamento) de uma linha anterior do mesmo arquivo.

Retomada: se a aba fechar, a importação fica "recebendo" (ou "finalizando"). "Retomar" baixa
o original do Storage, confere o SHA-256 registrado, relê e envia só o que falta. Uma
importação "finalizando" não pode ser cancelada.

### 3.1 Desempenho medido e duas correções feitas nesta fase

O teste de carga (`80_load.sql`, 70 mil linhas) mostrou dois problemas, e os dois foram
corrigidos antes desta entrega:

1. **RLS por linha.** Com `using (in_scope(tenant_id))`, contar 70 mil relacionamentos levou
   **7,3 s**, porque `in_scope()` (security definer) roda uma vez por linha. As políticas
   agora usam `tenant_id = any ((select tax_scope_tenants())::uuid[])`: o conjunto de
   tenants é calculado uma vez por consulta, com o mesmo critério de `in_scope()`. A mesma
   contagem caiu para **12,7 a 18,6 ms**. Um teste confere, para cada um dos 13 usuários de
   teste, que `tax_scope_tenants()` devolve exatamente os tenants em que `in_scope()` é
   verdadeiro. `in_scope()` em si não foi alterada.
2. **Finalização numa chamada só.** Numa execução, finalizar 70 mil linhas de uma vez levou
   **140 s**. Tabela temporária sem estatística levou o planejador a um laço aninhado. Mesmo
   no caso bom (6,9 s), o tempo fica perto do `statement_timeout` de 8 s que o Supabase usa
   para o papel `authenticated`. Agora a finalização roda em trechos de 10 mil linhas, com
   `analyze` na tabela temporária. Resultado: 7 chamadas, a pior em **1,17 s**, total 7,3 s.

Os números completos estão em `evidencias-fase-1.md`.

## 4. Segurança

* **RLS** ligado nas 16 tabelas, só com políticas de SELECT. `authenticated` não tem
  INSERT, UPDATE, DELETE nem TRUNCATE em nenhuma tabela do módulo, e `anon` não tem nada.
  Toda escrita passa por RPC.
* **Funções security definer** com `search_path` fixo terminando em `pg_temp`. Teste de
  catálogo garante isso para toda função `tax_*`.
* **EXECUTE** revogado de `public` e `anon` em todas as funções. As internas (`tax_audit`,
  `tax_can_write`, `tax_import_summary`, gatilhos) também são revogadas de
  `authenticated`. Só as 4 RPCs da importação e os auxiliares de visibilidade são
  executáveis.
* **Papéis** (seção 3.5 da especificação): importar é permitido a platform_admin,
  platform_ops, channel_admin (do canal pai), owner e finance. Ler o log do módulo é
  permitido a esses mesmos papéis mais platform_risk. Os demais papéis só leem dados.
* **Imutabilidade**: consultas, histórico ECF, eventos e logs não aceitam UPDATE, DELETE ou
  TRUNCATE, nem pelo dono da tabela. Período de regime só ganha data de fim uma vez.
  Evidência só passa de ativa para revogada ou substituída.
* **Documentos**: buckets privados `tax-imports` (30 MB) e `tax-evidences` (20 MB), sem
  política de UPDATE ou DELETE. Arquivo de evidência só é baixável se a evidência estiver
  registrada.
* **Auditoria**: cada operação grava `tax_audit_logs` (autor, papel, tenant, antes e
  depois) e também o `audit_log` existente, que aparece na tela Auditoria.

## 5. Ajuste 1: biblioteca de XLSX

* **exceljs 4.4.0** (licença MIT) para XLSX e **papaparse 5.5.3** (MIT) para CSV. Ambas
  são compatíveis com uso comercial e estão travadas em `bun.lock`.
* CNPJ como texto: célula numérica vira o texto do inteiro (`toFixed(0)`), sem notação
  científica. Rich text e fórmula usam o texto ou o resultado.
* Proteções antes de a biblioteca abrir o arquivo (`zip-guard.ts`): no máximo 30 MB de
  arquivo, 300 MB descompactados, 5.000 entradas e taxa de compressão 200 por entrada
  grande. ZIP64 é recusado. O CSV é limitado a 30 MB, e o total a 100 mil linhas.
* O banco repete os limites (`tax_imports.file_size_bytes`, `expected_rows`, lote de 1.000
  linhas e 2 MB).

## 6. Ajuste 2: IBS e CBS separados

* `tax_evidence_fact` tem `ibs_regular` e `cbs_regular` como fatos distintos. Cada
  evidência prova um só fato, com vigência própria (`valid_from` / `valid_to`).
* `tax_tenant_classifications` guarda `ibs_regular`, `ibs_valid_from`, `ibs_valid_to`,
  `ibs_basis` e o mesmo conjunto para CBS (`cbs_*`), sem dependência entre eles.
* Ausência de evidência de um não bloqueia o registro do outro. Testes: evidência só de CBS
  é aceita sem a de IBS, e uma classificação com CBS = sim mantém IBS =
  `nao_identificado`.
* Uma evidência não aceita o valor `nao_identificado`: ausência de informação não é
  registrada como fato.
* Não há fonte pública gratuita para a opção pelo regime regular de IBS/CBS. O catálogo
  registra `ibs_cbs_regular` como `indisponivel`. Até haver fonte, a informação vem só de
  evidência documental do tenant.

## 7. Ajuste 3: segurança do executor (Fase 2, desenho)

O executor do cruzamento com os dados abertos da Receita é um GitHub Actions disparado à mão.
Ele não existe nesta fase. O desenho abaixo é o que a Fase 2 vai implementar e testar.

* **Papel próprio `tax_ingestor`** (LOGIN, sem BYPASSRLS, sem `service_role`). Não tem
  privilégio em tabela nenhuma. Tem EXECUTE apenas em funções `tax_ingest_*`.
* **Funções do executor**: security definer, `search_path = public, pg_temp`, EXECUTE
  revogado de public, anon e authenticated, e concedido só a `tax_ingestor`. Cada uma
  confere `session_user = 'tax_ingestor'`.
* **Validação de lote**: no máximo 1.000 registros e tamanho máximo por chamada. As chaves
  são conferidas como na importação. A chave é validada contra a granularidade (CNPJ de 14
  posições ou raiz de 8). `dataset_version` precisa existir em `tax_source_runs`. Só entra
  CNPJ que está no conjunto-alvo daquela execução. Gravar duas vezes a mesma
  `(fonte, competência, chave)` é recusado por índice único (já testado em
  `70_separation.sql`).
* **Exposição mínima da carteira**: o executor recebe só a lista de CNPJs distintos e raízes
  (`tax_ingest_targets(run_id)`). A lista não traz tenant, nome declarado, tipo de
  relacionamento, quantidade por tenant ou origem. Ele não consegue dizer de quem é cada
  CNPJ. A lista não é gravada em disco do runner, nem em log ou artefato.
* **Credenciais**: a senha do `tax_ingestor` fica em secret de *environment* do GitHub
  com aprovação manual obrigatória (*required reviewers*). Ela não fica em secret de
  repositório. A conexão é TLS. A senha pode ser trocada sem afetar o app. Os logs mascaram
  o secret, e o job não roda em `pull_request` de fork.
* **Registro**: cada execução grava `tax_source_runs` (início, fim, arquivos com SHA-256,
  linhas lidas e casadas) e `tax_audit_logs`.

## 8. Ajuste 4: custo do GitHub Actions

`tax_source_runs` já tem as colunas de medição: `duration_seconds`, `runner_minutes`,
`bytes_downloaded`, `peak_disk_bytes`, `rows_scanned`, `rows_matched`, `targets_count` e
`metrics` (jsonb para o tempo por etapa). A Fase 2 preenche essas colunas em toda execução.

Os números reais só existem depois da primeira execução real na Fase 2. **Não há estimativa
inventada aqui.** A projeção será feita com os valores medidos:

```
minutos por execução  = download + descompactação + varredura + gravação
minutos por mês       = execuções no mês × minutos por execução
```

* O custo depende do **tamanho dos arquivos da Receita**, não do número de tenants. O
  executor baixa e varre cada arquivo uma vez e casa contra o conjunto consolidado de CNPJs
  de todos os tenants. Um tenant a mais só aumenta `targets_count` (memória do conjunto e
  linhas gravadas).
* Disco temporário: o pico (`peak_disk_bytes`) é comparado ao espaço livre do runner. Os
  arquivos são processados um por vez, em fluxo, e apagados em seguida.
* Execução manual: o número de execuções por mês é decisão do usuário. Sem agenda, não há
  custo recorrente automático.
* Cota gratuita e preço por minuto do plano da conta: **a confirmar** na página de cobrança
  do GitHub da organização antes da Fase 2. Os valores mudam com o plano.

## 9. O que não foi tocado

* A regra existente que classifica todo não optante do Simples como Lucro Presumido
  (`regime_from_registry`, `regime_hint` em `src/lib/cnpj.server.ts`) **não foi alterada e
  não é usada** pelo módulo. O teste `src/lib/tax-intel/separation.test.ts` garante que o
  módulo e as migrations 024x não referenciam essa regra nem as tabelas do cadastro antigo.
* `in_scope()`, `has_role()`, `log_audit()` e demais funções existentes não foram alteradas.
  Os stubs de teste são cópia literal das definições lidas do banco em uso.
* Fora dos arquivos novos, o diff toca só em: `package.json` e `bun.lock` (exceljs e papaparse,
  mais `@types/papaparse` em desenvolvimento), `src/lib/tenant-nav.ts` (1 grupo de menu) e `src/routeTree.gen.ts` (rota gerada).
