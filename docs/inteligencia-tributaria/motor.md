# Motor de consulta tributária em massa

Estado em 17/11/2026: **implementado e testado localmente com dados sintéticos.
Nada foi aplicado no Supabase, nada rodou contra os servidores da Receita.**
A matriz de fontes, cobertura, limitações e custo está em
[matriz-de-fontes-motor-em-massa.md](matriz-de-fontes-motor-em-massa.md).

## Como funciona

1. O executor (`scripts/tax-intel/executor/run.mjs`, Node 22, sem dependências
   além de `pg`) lê a listagem pública da Receita, escolhe a competência e baixa
   cada ZIP para uma pasta temporária.
2. Lê o CSV dentro do ZIP em fluxo (ISO-8859-1, `;`, aspas), sem descompactar em
   disco, e cruza cada linha com o conjunto de CNPJs/raízes das carteiras.
3. Confere o layout nas primeiras 2.000 linhas de cada arquivo. Arquivo fora do
   layout para a execução inteira (`abortada_layout`); nada é gravado dele.
4. Grava só as linhas casadas, em lotes de até 1.000, pelas funções
   `tax_ingest_*` da 0242, conectado como `tax_ingestor`. Esse papel não lê nem
   escreve tabela nenhuma: só chama as funções, que conferem que cada chave está
   em alguma carteira.
5. CNPJ da carteira que não apareceu no arquivo vira `nao_encontrado` daquela
   fonte e competência (evidência de ausência, com data).
6. Reclassifica a carteira em trechos de 10 mil e registra evento quando a
   classe muda.

Fontes: Simples/SIMEI (`Simples.zip`), Empresas, Estabelecimentos (+ Municípios)
dos Dados Abertos do CNPJ, e o regime tributário declarado na ECF. Layout do
regime: lido pelo **cabeçalho**.

**Endereço (conferido em 18/11/2026 pelo runner do GitHub):** as pastas antigas
`/dados/cnpj/dados_abertos_cnpj/` e `/dados/cnpj/regime_tributario/` dão 404. A
raiz de `arquivos.receitafederal.gov.br` redireciona para um compartilhamento
público do Nextcloud (`index.php/s/<token>`), lido pelo WebDAV público
(`public.php/webdav`, usuário = token, senha vazia). O executor descobre o token
pela raiz a cada execução.

- CNPJ: `/Dados/Cadastros/CNPJ/AAAA-MM/` (Empresas0-9, Estabelecimentos0-9,
  Simples, Socios0-9, Municipios etc.).
- Regime (ECF): `/Dados/Obrigacoes_Acessorias/ECF/entidades-lucro-real.zip`,
  `entidades-lucro-presumido.zip` (um CSV por ano, 2019 a 2024) e
  `entidades-lucro-arbitrado.zip`. CSV separado por **vírgula**, colunas
  `ano,cnpj,cnpj_da_scp,forma_de_tributacao,quantidade_de_escrituracoes`.
  Anos cobertos pelos dicionários: Real e Arbitrado 2016 a 2024, Presumido
  2019 a 2024. Formas mistas aparecem em todos os arquivos das formas
  abrangidas. `entidades-imunes-e-isentas.zip` existe mas não é lido.

## Regras de classificação (0242, `tax_classify_compute`)

| Ordem | Classe | Quando |
|---|---|---|
| 0 | nao_identificado (CNPJ inexistente) | o número não consta em Estabelecimentos; se for "000" + CPF válido, a base marca `provavel_cpf` (0252) |
| 1 | consulta_pendente | nenhuma consulta ao Simples para a raiz |
| 2 | mei_simei | opção pelo SIMEI ativa |
| 3 | simples_nacional | opção pelo Simples ativa |
| 4 | lucro_real / lucro_presumido | ECF da empresa (raiz; declarada pela matriz) de ano posterior à saída do Simples, ou do próprio ano quando a saída foi antes de 31/12 (0252), com uma única forma de tributação no ano; o ano vai na base |
| 5 | excluido_simples | saiu do Simples e não há ECF posterior que decida |
| 6 | nao_identificado | nunca optou e não há ECF; a base diz "Ausência de opção pelo Simples não indica Lucro Presumido nem Lucro Real." |

Não usa `regime_from_registry`, `cnpj_registry` nem `counterparties.regime`.

## Rastreabilidade

Cada CNPJ guarda, em `public_classification_basis`: fonte, competência dos
dados (ou ano-calendário da ECF), datas de opção/exclusão, aviso quando houver e
o id da execução. Cada consulta fica em `tax_consultations` (imutável) com
fonte, competência, data, status, linha bruta e linha normalizada. O painel
mostra isso no detalhe do CNPJ. O Excel é o diagnóstico para o cliente sanear a
base (`src/lib/tax-intel/diagnosis.ts`): toda linha sai com status, causa, ação
recomendada e prioridade, e as abas são Resumo, Base diagnosticada, Saneamento
(com colunas para o cliente responder) e Metodologia.

## Idempotência, cache e retomada

- `(fonte, competência, chave)` grava uma vez só. Repetir um lote devolve
  `cached` e não duplica.
- `tax_ingest_start_run` com a mesma competência e as mesmas fontes retoma a
  execução aberta. Outra competência com execução aberta é recusada.
- `tax_ingest_file` guarda a última linha confirmada de cada arquivo; a
  retomada pula o que já entrou.

## Evidências (pasta `evidencias/motor/`, todas com dados SINTÉTICOS)

Arquivos gerados por `gen-sintetico.mjs` no formato da Receita: 60.648 CNPJs de
carteira contra 5.960.399 linhas.

| Teste | Resultado | Arquivo |
|---|---|---|
| Varredura sem banco | 5,96 mi linhas em 2 s | relatorio-1-sem-banco.json |
| Varredura com gravação no banco local | 66 s, 60.648 classificados | relatorio-2-banco.json |
| Repetição da mesma competência | 16 s, tudo `cached`, 0 classes alteradas | relatorio-3-cache.json |
| Nova competência, com `kill -9` no meio e retomada | concluída; 1.276 mudanças de classe com evento | relatorio-4-nova-competencia-retomada.json |
| Invariantes (Real/Presumido sem ECF, sem ano, sem aviso, sem fonte) | todas 0 | invariantes-banco-local.txt |
| Suíte SQL com carga de 70 mil linhas | 285/285 | suite-sql-70k.txt |
| Testes unitários (inclui 10 do executor) | 167/167 | vitest.txt |
| Exportação Excel de 60.656 linhas pelo painel | 55 s no navegador | (planilha não versionada) |
| Reversão da 0242 em transação no Supabase local | funções 191 → 180 → 191, papel removido, dados intactos | ciclo-reversao-0242.txt |

O relatório 4 mostra as contas vistas pelo executor numa execução retomada; a
fonte da verdade da execução é `tax_ingest_summary`, lida do banco.

**O que esses números não provam:** tempo de download real, volume real dos
arquivos, layout real do regime tributário e disponibilidade dos servidores da
Receita. Isso só a sonda responde.

## Sonda (antes de qualquer carga)

Não grava nada nem precisa de senha. Cruza só quatro CNPJs públicos de grandes
empresas (Banco do Brasil, Petrobras, Caixa, Itaú Unibanco), únicos que podem
aparecer no log.

```
node scripts/tax-intel/executor/run.mjs --sonda \
  --datasets receita_simples,receita_regime_tributario \
  --relatorio relatorio-sonda.json
```

Sem `--datasets`, baixa também Empresas e Estabelecimentos (vários GB compactados).

## Execução em produção (depois das autorizações)

Pré-requisitos, em ordem: 0235/0240/0241 aplicadas; 0242 aplicada com
autorização própria; login do papel habilitado manualmente, fora do Git:

```sql
alter role tax_ingestor login password '<senha forte, guardada no cofre>';
```

`TAX_INGESTOR_DATABASE_URL` aponta para o pooler em modo sessão com esse
usuário. Nunca `service_role`.

O workflow `.github/workflows/tax-intel-motor.yml` roda manualmente
(`workflow_dispatch`) e, desde 18/11/2026 (autorizado pelo usuário), também
todo dia às 06:30 de Brasília pela verificação diária. Só vale depois de estar
na `main`:

- `verificar` (agendado): lê só a listagem da Receita, sem baixar arquivo, e
  calcula a impressão digital da competência mais recente do CNPJ e dos
  arquivos do regime (ETag de cada arquivo). Se essa impressão já foi
  carregada (marcada no cache do Actions ao fim de uma carga completa), não faz
  nada. Se mudou, dispara a `carga` com todas as fontes.
  CNPJ/Simples saem por mês; a ECF, uma vez por ano.
  Com aprovação obrigatória no ambiente `tax-intel-producao`, a carga diária
  fica esperando alguém aprovar; para ser automática, o ambiente não pode
  exigir revisor.

- `sonda`: sem segredo, publica o relatório como artefato.
- `carga`: exige o ambiente `tax-intel-producao` com aprovação manual e o
  segredo `TAX_INGESTOR_DATABASE_URL` nesse ambiente. O TLS do pooler é verificado com a raiz pública Supabase Root 2021 CA, que fica em `scripts/tax-intel/executor/supabase-root-2021-ca.crt` (sha256 80:70:25:AD…, válida até 2031-04-26). Não publica artefato
  (o repositório é público); o log só tem contagens.

## Reversão

`rollback-0242.sql` remove as 11 funções, o papel `tax_ingestor` e a linha do
histórico. Não apaga dados gravados pelo motor nas tabelas da 0240.
Front-end e executor: reverter o commit.

## Cache dos arquivos da Receita

O servidor da Receita entrega cerca de 0,6 MB/s e derruba downloads longos. Por isso:

- **Retomada:** cada download que cai continua do byte em que parou (HTTP Range). São até 12 tentativas, e um download parado há 2 minutos é abortado e retomado.
- **Cache mensal:** os arquivos da competência mais recente (~5 GB, dado público) ficam no cache do GitHub Actions.
  - A chave é a impressão da publicação: competência mais o ETag de cada arquivo. Se a Receita republicar um arquivo, a chave muda e o cache velho não é usado.
  - Na primeira carga do mês, tudo é baixado. Daí em diante, cada "Processar agora" lê do cache e leva minutos, não horas.
  - A verificação diária restaura o cache, o que o mantém vivo: o GitHub apaga um cache depois de 7 dias sem uso.
  - Um arquivo só vale como cache se o download terminou (o `.sha256` ao lado dele marca isso).
  - Uma competência escolhida à mão no disparo manual não usa o cache.
