# Como ligar a versão 2 da API da Receita (outubro/2026)

A versão 2 está **construída, testada e desligada**. Não é obra a fazer: é um
interruptor a virar, quando a Receita abrir.

## O interruptor

Uma variável de ambiente, em produção:

```
RTC_API_VERSAO=2
```

Só isso. Nenhuma alteração de código.

Enquanto ela não existir (ou for qualquer outro valor), **tudo segue pela
versão 1**. O padrão é desligado de propósito: enquanto a Receita não abrir a
versão 2, um pedido no endereço novo volta com erro **e queima uma das
consultas do dia**. Errar para o lado de não ligar custa zero; errar para o
outro custa consulta.

## O que muda quando ligar

| | Versão 1 | Versão 2 |
|---|---|---|
| Consultas por dia | 2 | 4 |
| Como vem o arquivo | comprovante de uso único | endereço temporário, vale 48 h |
| Período | a competência que você pedir | só o mês corrente, acumulando |

## O que NÃO muda

**Competência fechada continua na versão 1**, mesmo com o interruptor ligado.
A versão 2 não atende período fechado — a janela dela é incremental e começa no
dia 1º do mês corrente. Quem decide isso, pedido a pedido, é
`versaoDaAbertura` em `src/lib/rtc-v2/versao.ts` (função pura, com teste).

Por isso não existe troca silenciosa de período: a versão 2 só é escolhida
quando a competência pedida **já é** o mês corrente.

## Antes de virar o interruptor

1. Confirmar que a Receita abriu mesmo a versão 2 (não confiar só no anúncio).
2. Conferir que o limite de 4 aparece certo na tela. O número não está mais
   cravado no código — vem do banco, pela migração 0228.
3. Fazer **um** pedido e olhar o histórico da linha (coluna `historico`, criada
   pela migração 0230) antes de fazer o segundo.

## O que continua faltando, independente do interruptor

- **Créditos, pagamentos e recolhimentos** têm o caminho pronto
  (`abrirSolicitacaoV2`, `lerListaV2`) mas nenhum botão. São recursos que a
  Receita ainda não entregou.
- **O limite de 8 downloads por dia não é contado.** O mecanismo existe no
  banco (`rtc_quota_take` com tipo `download`), nenhum lugar do aplicativo o
  aciona. Quem automatizar a fila de recuperação precisa ligar isso antes.
