# Roteiro: do sistema ao produto diferencial

**23/09/2026.** Aprovado pelo usuário a partir da análise comercial da mesma data.

## A tese, em uma frase

A Receita entrega de graça o cálculo e a apuração. O TECH-IVA não compete com
isso — **usa o motor oficial** e vende o que a Receita não entrega:
**diagnóstico do erro sistemático, impacto no caixa, e conferência**, vendido
preferencialmente a quem atende muitas empresas (escritório contábil).

## Por que esta ordem

Cada fase depende da anterior ser confiável. Um produto que vende "número
oficial" não pode mostrar número errado com cara de oficial — e em 23/09 ainda
havia caminhos fazendo isso. Por isso o alicerce vem antes de qualquer novidade.

| Fase | O quê | Depende de | Plano detalhado |
|---|---|---|---|
| **0** | **Alicerce**: verificação automática, fluxo de publicação, nenhum número inventado, experimento da Receita | — | [2026-09-23-fase-0-alicerce.md](2026-09-23-fase-0-alicerce.md) |
| 1 | **Selo em todo número**: versão do motor, versão da regra e base legal visíveis debaixo de cada valor | 0 | a escrever ao iniciar |
| 2 | **Auditoria na frente**: o primeiro passo do usuário vira "suas notas → seus erros sistemáticos → R$ em risco" | 0, 1 | a escrever ao iniciar |
| 3 | **Menos digitação**: simulador e demais telas partem de nota autorizada, não de código digitado | 2 | a escrever ao iniciar |
| 4 | **Receita como conferência silenciosa**: uma consulta automática por dia; a tela mostra só a diferença | 0 (experimento da Receita concluído) | a escrever ao iniciar |
| 5 | **Split payment no caixa com dado real**: "na semana de X vão faltar R$ Y, por causa destas notas" | 2 | a escrever ao iniciar |
| 6 | **Visão de carteira do contador**: risco por cliente, auditoria em lote, relatório com a marca do escritório | 2, 5 | a escrever ao iniciar |

**Por que só a Fase 0 tem plano detalhado agora:** as outras dependem de
decisões que ainda não foram tomadas (quais telas saem, o que o contador de
fato pede) e do que a Fase 0 revelar. Escrever tarefa por tarefa agora
produziria um plano cheio de suposição — exatamente o erro que custou um mês na
integração com a Receita. Cada fase ganha o seu plano detalhado quando começar.

## Decisões que são do usuário

**1. Corte de telas.** O sistema tem mais de 25 telas. O núcleo diferenciador
cabe em cinco: Auditoria, Validador, Caixa/Split, Preço e Conferência com a
Receita. Candidatas a esconder ou retirar até o núcleo estar impecável:
comissões, cadeia, carteira de parceiros, crédito, finanças, operações, marca,
planos. **Não mexo nisso sem decisão sua** — é produto, não código.

**2. Conversas com clientes.** Antes das Fases 2 e 6, cinco conversas com
escritórios contábeis. A análise de 23/09 foi feita a partir do código e da
documentação, não de cliente — é dedução, não evidência. As conversas decidem
o que a Fase 2 mostra primeiro e se a Fase 6 é mesmo o canal.

## O que não muda

- **Nenhum número chega à tela sem vir do motor oficial.** Não entendeu a
  resposta = erro explícito, nunca zero.
- **Ausente não é zero.** Valor que não sabemos aparece como "—", nunca R$ 0,00.
- **Linguagem clara**, sem jargão, em tudo que o usuário lê.
