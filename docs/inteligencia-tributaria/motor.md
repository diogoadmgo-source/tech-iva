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
dos Dados Abertos do CNPJ, e o regime tributário declarado na ECF
(`regime_tributario/`). Layout do regime: lido pelo **cabeçalho**, porque ainda
não foi confirmado num arquivo real (ver a sonda abaixo).

## Regras de classificação (0242, `tax_classify_compute`)

| Ordem | Classe | Quando |
|---|---|---|
| 1 | consulta_pendente | nenhuma consulta ao Simples para a raiz |
| 2 | mei_simei | opção pelo SIMEI ativa |
| 3 | simples_nacional | opção pelo Simples ativa |
| 4 | lucro_real / lucro_presumido | ECF de ano **posterior** à última saída do Simples, com uma única forma de tributação no ano; o ano vai na base |
| 5 | excluido_simples | saiu do Simples e não há ECF posterior que decida |
| 6 | nao_identificado | nunca optou e não há ECF; a base diz "Ausência de opção pelo Simples não indica Lucro Presumido nem Lucro Real." |

Não usa `regime_from_registry`, `cnpj_registry` nem `counterparties.regime`.

## Rastreabilidade

Cada CNPJ guarda, em `public_classification_basis`: fonte, competência dos
dados (ou ano-calendário da ECF), datas de opção/exclusão, aviso quando houver e
o id da execução. Cada consulta fica em `tax_consultations` (imutável) com
fonte, competência, data, status, linha bruta e linha normalizada. O painel
mostra isso no detalhe do CNPJ e o Excel traz as colunas "Fonte da
classificação", "Referência (competência ou ano da ECF)" e "Base da
classificação".

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

O workflow `.github/workflows/tax-intel-motor.yml` só roda manualmente
(`workflow_dispatch`) e só depois de estar na `main`:

- `sonda`: sem segredo, publica o relatório como artefato.
- `carga`: exige o ambiente `tax-intel-producao` com aprovação manual e o
  segredo `TAX_INGESTOR_DATABASE_URL` nesse ambiente. Não publica artefato
  (o repositório é público); o log só tem contagens.

## Reversão

`rollback-0242.sql` remove as 11 funções, o papel `tax_ingestor` e a linha do
histórico. Não apaga dados gravados pelo motor nas tabelas da 0240.
Front-end e executor: reverter o commit.
