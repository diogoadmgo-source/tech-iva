# FLUXA — Pacote de implementação faseado
## Como usar estes documentos (leia antes de abrir o Lovable)

Este pacote substitui a spec única (v1.0) por **quatro documentos executáveis**, na ordem em que devem ser implementados:

| # | Documento | O que entrega | Quem executa |
|---|-----------|---------------|--------------|
| 01 | `01_FUNDACAO_multitenant_banco_seguranca.md` | Banco, hierarquia de tenants, RLS, Auth, convites, papéis, auditoria, painel mínimo de gestão | Supabase (SQL aplicado por mim/DBA) + Lovable (telas de login/gestão) |
| 02 | `02_APIS_e_servicos.md` | Contratos de RPC (Supabase), Edge Functions, serviços em container (ingestor, calculadora, classificador, projetor, preço, crédito), jobs, realtime, webhooks | Serviços: dev/Claude Code em repositório próprio · RPCs: Supabase · Edge: Lovable |
| 03 | `03_TELAS_e_funcionalidades.md` | Design system premium, app shell, telas T1–T5, painel do canal, painel da plataforma, onboarding, alertas | Lovable |
| — | `SPEC_Plataforma_Caixa_IVA_v1.md` (já entregue) | Contexto de negócio, tese, riscos, métricas | Leitura de referência |

## Regras de execução (não pular)

1. **Uma fase por vez, um bloco por vez.** Cada documento tem blocos numerados (1.1, 1.2…). Cole no Lovable **um bloco**, valide os critérios de aceite do bloco, só então cole o próximo. Colar o documento inteiro faz a IA simplificar e esquecer segurança.
2. **O SQL da fundação não é gerado pelo Lovable.** O schema, as funções e as políticas do 01 são aplicados diretamente no Supabase (migration). O Lovable só consome. Isso evita o erro mais comum: RLS incompleta.
3. **Serviços pesados ficam fora do Lovable.** Tudo o que está em `02 › Seção C` roda em container próprio e fala com o Supabase por service role. O Lovable nunca chama Receita, SEFAZ, banco ou FIDC diretamente.
4. **Critérios de aceite são testes, não sugestões.** Cada bloco lista o que tem que passar. Em especial os testes de RLS (usuário do canal, da empresa, da plataforma) rodam a cada bloco que cria tabela.
5. **Design system antes de tela.** No 03, o bloco 3.1 (tokens + componentes) vem antes de qualquer tela. Sem isso, o Lovable entrega shadcn padrão.
6. **Prompt = contexto fixo + bloco.** Todo prompt para o Lovable começa com o "cabeçalho de contexto" abaixo, seguido do bloco.

## Cabeçalho de contexto (colar no início de todo prompt do Lovable)

```
Você está implementando o FLUXA, SaaS multi-tenant hierárquico (platform > channel > company > unit)
sobre Supabase. Regras invioláveis:
- Toda tabela de dado tem tenant_id NOT NULL, RLS habilitada e índice em (tenant_id, ...).
- Leitura: o usuário vê o próprio tenant e descendentes (função auth_scopes()). Escrita: só no próprio tenant.
- Nenhuma lógica tributária ou financeira no front; o front lê tabelas/views e chama RPCs.
- Toda ação que altera dinheiro, regra, permissão ou tenant grava em audit_log.
- Valores monetários em cents (bigint). Formatação só na tela, com tabular-nums.
- Estado de servidor via TanStack Query; nunca localStorage para dado de negócio.
- Design system: dark premium (Inter + JetBrains Mono), superfícies em 3 elevações, shadcn estendido.
- Toda tela tem estados: loading (skeleton), vazio, erro com ação, sem permissão.
Não invente tabelas nem colunas: use exatamente o schema fornecido. Se algo faltar, pergunte.
```

## Cronograma sugerido
| Semana | Fase | Marco |
|---|---|---|
| 1 | 01 (blocos 1.1–1.4) | Banco + RLS + Auth aplicados e testados |
| 2 | 01 (1.5–1.7) + 03 (3.1) | Gestão de usuários/tenants no Lovable + design system |
| 3–4 | 02 (Seções A, B, C1–C3) | RPCs, ingestor, calculadora, classificador rodando |
| 5–6 | 03 (T2, T1) | Carteira e Caixa do Imposto com dado real |
| 7 | 02 (C4) + 03 (T4, canal) | Regime + painel do canal → **MVP** |
| 8–9 | 02 (C5) + 03 (T3) | Preço |
| 10+ | 02 (C6) + 03 (T5) | Financiamento (paralelo ao jurídico do FIDC) |
