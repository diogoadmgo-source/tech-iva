# TECH-IVA — padrão visual obrigatório (Premium Dark)

Toda tela do app segue este padrão. Referência já refatorada:
`src/routes/_authenticated/t.$tenantId.cash.tsx` e
`src/components/techiva/modalidade.tsx`.

## Primitivos (usar SEMPRE)
- `Page` — container da tela (`src/components/techiva/page.tsx`).
- `PageHeader` — `eyebrow`, `title`, `help` (balão "?"), `actions`.
- `Panel` — cartão com profundidade: `title`, `icon` (lucide), `help`, `actions`.
- `Segmented` — único controle de abas curtas/horizonte. Não usar Tabs improvisadas
  para 2-4 opções curtas.
- `Rise index={n}` — entrada animada em cascata; envolver cada bloco de topo da
  página em ordem crescente.
- `InfoHint` (`src/components/techiva/info-hint.tsx`) — micro balão "?" com o texto.

## Regras rígidas
1. ZERO parágrafo explicativo solto na tela. Todo texto de instrução,
   premissa, base legal ou aviso vai para `help` de `PageHeader`/`Panel` ou um
   `InfoHint` ao lado do rótulo. Se um `<p className="text-...muted">` explica algo,
   ele é removido e o conteúdo migra para o balão.
2. Nenhuma cor literal (`text-white`, `bg-black`, `bg-[#...]`). Só tokens
   semânticos (`text-foreground`, `bg-surface-2`, `text-primary`, `border-border/60`,
   `text-destructive`, etc.).
3. Cabeçalho sempre `PageHeader` com `eyebrow` curto em maiúsculas
   (ex. "CAIXA", "FERRAMENTAS", "ADMINISTRAÇÃO") e `help` explicando a tela.
4. Seções sempre `Panel` com `icon` lucide + `help`. Não usar `Card`/`CardHeader`
   cru do shadcn para seções de página; `Panel` substitui.
5. Estados: usar `EmptyState`, `ErrorState`, `NoPermissionState`
   (`src/components/techiva/empty-state.tsx`) e `Skeleton` para carregando.
   Nunca texto pelado "Carregando..." ou "Nenhum registro".
6. Densidade comercial: rótulos curtos, `text-xs`/`text-sm`, números em
   `font-mono tabular-nums`, valores monetários via `MoneyText`/`formatCents`.
7. Movimento discreto: `Rise` nos blocos, `panel-hover` já vem do `Panel`.
   Não adicionar animações novas em CSS.
8. Nunca alterar lógica de negócio, queries, RPCs, permissões ou nomes de
   campos. É trabalho de apresentação: reorganizar JSX, trocar containers,
   mover texto para balões. Comportamento idêntico.
9. Manter/ajustar o `head()` da rota (título único, description, og/twitter) —
   não remover.
10. PT-BR na interface. Sem emoji.
11. Mobile primeiro: a maioria dos usuários abre em 430px. Grades sempre
    `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` ou similar; nenhuma linha deve
    estourar horizontalmente; tabelas largas ganham wrapper `overflow-x-auto`.

## Checklist antes de terminar cada arquivo
- [ ] Importa `Page, PageHeader, Panel, Rise` (e `Segmented` se aplicável).
- [ ] `rg -n "text-white|bg-black|bg-\[#" arquivo` retorna vazio.
- [ ] Nenhum parágrafo explicativo remanescente na tela.
- [ ] `tsgo` sem erros novos nos arquivos tocados.
