# Conferência do que está escrito × o que está feito
**16/09/2026 — API de Apuração de Débitos da CBS**

Fonte: *Manual Plataforma CBS — 21/Maio/2026*, seção "API", e o anúncio da versão 2.
Método: cada frase do manual que obriga alguma coisa virou uma linha. Para cada uma,
fui no código ver o que ele faz. Sem suposição: onde havia prova no banco, ela está citada.

---

## 1. O que o manual manda, e o que fazemos

| # | O manual diz | O código faz | Situação |
|---|---|---|---|
| 1 | Endereço base `api.receitafederal.gov.br` | Igual | ✅ |
| 2 | Autenticar em `/token` com as duas chaves | Igual | ✅ |
| 3 | **O token vale 1 hora e serve para pedir E para baixar** | Guarda o token do pedido e reusa no download; só pede outro se levar recusa | ✅ |
| 4 | Pedir em `/rtc/apuracao-cbs/v1/{cnpj}`, CNPJ com 8 dígitos | Igual, com zeros à esquerda | ✅ |
| 5 | CNPJ no endereço, token no cabeçalho, endereço de retorno no corpo | Igual | ✅ |
| 6 | 2 pedidos por dia, por CNPJ | Contado por CNPJ, não por competência | ✅ |
| 7 | Pedido que dá errado consome a chamada | Só desconta quando a Receita foi realmente chamada; erro nosso devolve | ✅ |
| 8 | Estourou a cota, vem erro 429 | Tratado | ✅ |
| 9 | Baixar em `/rtc/download/v1/{tiquete}` | Igual | ✅ |
| 10 | **8 downloads por dia** | **Ninguém conta.** Existe o mecanismo, não é usado | ❌ |
| 11 | **Um único acesso por tíquete** | O código pode tentar duas vezes (token guardado, depois token novo) | ⚠️ |
| 12 | O arquivo fica 24 horas disponível | Assumido como verdade — **a realidade desmentiu** (item 3 abaixo) | ❌ |
| 13 | Devolve JSON com a lista de débitos | Lido e gravado antes de interpretar | ✅ |
| 14 | Só Débitos existe hoje | Respeitado | ✅ |

---

## 2. O que o manual **não** diz, e nos custou

**a) Existe um limite de velocidade no `/token`.**
Nenhum manual menciona. Provado no banco em 15/09 às 20:34 e 20:35:
`{"message":"API rate limit exceeded"}`, HTTP 429, em resposta ao `/token` —
que, segundo o manual, não tem cota nenhuma.

**b) O nome do campo que a Receita devolve no retorno.**
O manual chama de "TíqueteDownload" no texto corrido. O que chegou de verdade foi
apenas `tiquete`. Nosso código aceitava os dois — acertou por precaução, não por leitura.

---

## 3. A contradição do manual, e como a realidade decidiu

O manual diz as duas coisas, na mesma página:

> "sendo permitido **um único acesso por tíquete**"
> "O arquivo ficará disponível para download por 24 horas. Durante esse período,
> será possível baixar o arquivo **quantas vezes ela quiser**."

Eu registrei isso como contradição não resolvida e escolhi trabalhar com a leitura
permissiva. **Foi o erro de julgamento central desta implementação.**

O que o banco mostra, sem interpretação:

| Momento | O que aconteceu |
|---|---|
| 15/09 20:13:50 | Pedido aceito (201) |
| 15/09 20:13:51 | Retorno da Receita chega — **1,5 segundo depois** |
| 16/09 17:03:50 | Download tentado → **401: "Tíquete inexistente ou download já realizado."** |

O campo `download_em` está vazio: **nunca baixamos nada**. Mesmo assim, 20h50 depois
— dentro das 24 horas prometidas — o tíquete não existe mais.

**Conclusão:** a frase das 24 horas não se aplica ao tíquete. Vale a restritiva.

---

## 4. Falhas nossas, que a documentação não causou

**a) O diagnóstico apaga a tentativa anterior.**
Cada nova tentativa sobrescreve a anterior. A falha das 20:13 — a única que
importava — foi perdida quando reprocessamos hoje. Num recurso que custa 1 de 2 por
dia, o histórico tem que acumular, não substituir.

**b) O banco de produção não pode ser reconstruído pelo repositório.**
As migrações no projeto param em agosto (nº 0159). Produção está na 0229. Tudo que
foi feito nos últimos dias existe só no servidor. Se a base cair, não há de onde
levantar.

**c) A versão 2 está construída e desligada.**
`abrirSolicitacaoV2`, `lerDebitosV2` e `lerCreditosV2` não têm nenhum chamador.
Nenhum botão da tela alcança a versão 2. Foi construída, testada e não ligada.

**d) O limite de 8 downloads por dia não é contado** (item 10 acima).

---

## 5. O que muda no desenho

1. **Tratar o tíquete como bala única.** Uma tentativa de download, e só.
   O que se repete é o pedido inteiro — e isso custa 1 de 2 por dia.
2. **Nunca pedir token novo perto de um tíquete vivo.** O token do pedido vale
   1 hora; é o mesmo que baixa. Pedir outro expõe ao limite de velocidade.
3. **Guardar todas as tentativas**, não só a última.
4. **Trazer as migrações para o repositório** antes de qualquer coisa nova.
5. **Ligar a versão 2** na tela, ou assumir que ela não existe.
