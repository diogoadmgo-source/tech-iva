# Motor de consulta tributária em massa: matriz de fontes e viabilidade (70 mil CNPJs)

17/11/2026. A sandbox não alcança `arquivos.receitafederal.gov.br` (bloqueio do proxy) e o
leitor web foi barrado pelo `robots.txt` do servidor da Receita. Por isso:

* tudo o que está marcado **"a confirmar"** só é confirmado na primeira execução real do executor, no GitHub Actions;
* nenhum tamanho de arquivo, contagem ou tempo abaixo é estimado: são medidos na execução e gravados em `tax_source_runs`.

## Princípio

O motor não consulta CNPJ por CNPJ. Ele **baixa a base pública inteira da Receita uma vez** e
cruza localmente, em fluxo, com o conjunto consolidado de CNPJs de todas as carteiras.

* O custo depende do tamanho dos arquivos, não do número de CNPJs: 70 mil ou 700 mil CNPJs varrem os mesmos arquivos.
* Consulta pontual (API) só entra como complemento, para CNPJ novo entre duas publicações.

## Matriz

| # | Informação | Fonte | Mecanismo | Cobertura | Limitações | Custo |
|---|---|---|---|---|---|---|
| 1 | Cadastro: razão social, situação, UF, município, matriz/filial | Receita, Dados Abertos do CNPJ (Empresas, Estabelecimentos) | Download em lote dos arquivos mensais; cruzamento em fluxo | Todo CNPJ registrado na Receita | Foto mensal (defasagem de até ~1 mês); layout confirmado só na 1ª execução | Zero (dado aberto) |
| 2 | **Simples Nacional e SIMEI**: opção, data de opção, data de exclusão | Receita, Dados Abertos do CNPJ (arquivo do Simples), por raiz | Igual ao item 1 | Todas as raízes que já optaram | Mensal; não informa a opção pelo regime regular de IBS/CBS | Zero |
| 3 | Simples on-line, por CNPJ | Portal do Simples, "Consulta Optantes" | Formulário de **um CNPJ por vez**, para uso humano | Unitária | Não é mecanismo de acesso em lote. Protegido por hCaptcha invisível: na sonda de 19/11/2026 (GitHub Actions, uma consulta com o CNPJ público 00.000.000/0001-91) a primeira consulta automatizada já voltou "Impedido por proteção Captcha. Comportamento de Robô." Contornar o captcha não é aceitável. **Não será usado pelo motor**; só consulta feita por pessoa. | — |
| 4 | Cadastro + Simples por API | Serpro "Consulta CNPJ" (oficial) | API | Unitária | Paga (não consegui abrir a página de preços para confirmar valores) | **Fora do escopo** sem custo |
| 5 | Cadastro + Simples por API comunitária | BrasilAPI, OpenCNPJ | API pública gratuita | Unitária | Não são oficiais; republicam os mesmos dados abertos; limites de uso não confirmados | Zero; só complemento, nunca para os 70 mil |
| 6 | **Lucro Real, Presumido, Arbitrado, Imune/Isenta** | Receita, dados abertos de regime tributário declarado na ECF (`dados/cnpj/regime_tributario`, segundo a documentação da Minha Receita) | Download em lote anual; cruzamento pelo CNPJ completo | Só quem entregou ECF | **Histórico por ano-calendário, não regime vigente.** Publicado no ano seguinte. Optante do Simples não entrega ECF. Existência, anos e layout **a confirmar** na 1ª execução. | Zero |
| 7 | **Opção do Simples pelo regime regular de IBS/CBS** | Nenhuma fonte pública encontrada | — | — | A opção para o 1º semestre de 2027 foi de 01/09 a 30/10/2026 (Resolução CGSN 194). Agência Gov e CGIBS não citam consulta pública, lista, base aberta ou API. | — |
| 8 | IBS/CBS de não optantes | Não há cadastro público de "contribuinte regular de IBS/CBS" por CNPJ | — | — | Só por evidência documental privada do tenant (já previsto: `tax_evidences`) | — |

## O que a carteira de 70 mil vai mostrar (regras de classificação)

| Classe | Quando | Fonte e período registrados |
|---|---|---|
| Simples Nacional | Raiz com opção ativa no arquivo do Simples da competência | Arquivo, competência, data de opção |
| MEI / SIMEI | Opção SIMEI ativa | Idem |
| Excluído do Simples | Teve opção e tem data de exclusão | Idem, data de exclusão |
| Lucro Real / Lucro Presumido (histórico AAAA) | **Não** optante e com ECF declarada no ano AAAA | Arquivo do regime, ano-calendário, forma original |
| Não identificado | Não optante e sem ECF publicada | "Ausência de Simples não indica Presumido nem Real" |
| Consulta pendente | CNPJ ainda não cruzado | — |

**Regra fixa:** não optar pelo Simples nunca vira Lucro Presumido nem Lucro Real.
O Real ou o Presumido só aparece com o ano da ECF ao lado. O regime regular de IBS/CBS fica
"não identificado" até haver evidência do próprio tenant.

## Viabilidade real para 70 mil CNPJs, sem custo

* **Viável:** cadastro, Simples e SIMEI para 100% dos CNPJs que existem na base da Receita, porque é cruzamento local da base inteira.
* **Viável com limite de natureza:** Real e Presumido por ano. A cobertura depende de quantos da carteira entregaram ECF e de o arquivo estar publicado. A quantidade só aparece depois do cruzamento real.
* **Inviável hoje sem custo:** saber quem do Simples optou pelo regime regular de IBS/CBS, porque não há fonte pública. É também inviável consultar 70 mil por formulário ou por API oficial sem pagar.
* **Executor:** GitHub Actions disparado à mão.
  * O repositório é público, e no GitHub os runners padrão são gratuitos para repositório público.
  * Isso tem uma consequência: **logs de execução são públicos**. O desenho já não registra CNPJs da carteira em log nem em artefato, e isso vira teste obrigatório.

## Escala e controle

* **Lote:**
  * o executor lê a lista consolidada de CNPJs-alvo, sem tenant nem nome;
  * baixa um arquivo por vez, descompacta e varre em fluxo;
  * grava só as linhas casadas, em lotes de 1.000, por funções `tax_ingest_*` com papel próprio.
* **Incremental e cache:** a chave única `(fonte, competência, CNPJ)` impede gravar duas vezes. Uma competência já processada não é baixada de novo, e um CNPJ já cruzado naquela competência sai "via cache".
* **Deduplicação:** o mesmo CNPJ em vários tenants é cruzado uma vez só, porque o plano público é global.
* **Retomada:** `tax_source_run_files.last_row_committed` por arquivo, e execução interrompida continua de onde parou.
* **Atualização:** cada execução registra competência, arquivos com SHA-256, linhas lidas e casadas, duração e minutos. Uma nova competência gera eventos de mudança (entrada e saída do Simples, novo ano de ECF).
* **Evidência individual:** cada CNPJ guarda a consulta (fonte, competência, data da consulta, linha original, hash) e a classe calculada com a base usada.
* **Excel:** toda a carteira, com classe, fonte, competência ou ano de referência, data da consulta e motivo de "não identificado".

## Critério de aceite e como será demonstrado

1. Cruzamento real de uma amostra de CNPJs reais (os seus, de preferência) contra os arquivos reais da Receita, com o relatório de cada fonte.
2. A carteira de 70 mil importada e processada, com o painel por regime e por pendência, e o Excel com rastreabilidade.
3. Os números de cobertura são os medidos. Nada é presumido.
