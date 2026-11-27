# TECH-IVA

Projeção de IBS e CBS no caixa da empresa, com cálculo oficial da Receita Federal.

## Stack

- TanStack Start (React 19, SSR), TypeScript, Tailwind CSS 4
- Supabase (banco, autenticação, Edge Functions) — projeto `TechIVA-Prod`
- Hospedagem na Vercel (build via Nitro, preset `vercel`)
- Paddle (assinaturas) e Resend (e-mail), chamados diretamente pela API

## Desenvolvimento

Requer [Bun](https://bun.sh) e Node.js 22.

```sh
bun install
bun run dev        # http://localhost:8080
bun run test
bun run build      # gera .vercel/output
```

As variáveis públicas (`VITE_*`) estão em `.env`. As de servidor ficam na Vercel
(Project Settings → Environment Variables); para rodar localmente, copie-as para
um `.env.local` (não versionado). A lista completa está em
`docs/hospedagem-vercel.md`.

Para gerar um build Node em vez de Vercel: `NITRO_PRESET=node-server bun run build`.

Fluxo de publicação e de migrations: `docs/fluxo-de-trabalho.md`.

## Arquitetura do caixa do imposto (`tax_cash_events`)

O worker externo `project_cash` (executado fora do app, contra o mesmo banco) é o
dono da projeção futura:

- Em cada rodada ele **apaga e reescreve apenas os eventos com `event_date >= hoje`**.
- Eventos com data passada são **histórico** e ficam preservados — o worker nunca os toca.

Consequências práticas:

1. Dado de seed com data passada vira **órfão permanente**: o worker não o remove e
   ele continua somando no histórico. Por isso `db/seeds/0019_seed_dev_operation.sql`
   apaga **todos** os eventos do tenant (passados e futuros) antes de recriar.
2. Eventos `provision` são **sugestão de reserva, não movimento de caixa**. A RPC
   `dashboard_cash` (migration 0042) os exclui da timeline, do `next_gap` e do
   cálculo de gap, e os devolve separadamente em
   `kpis.provision_month_cents` / `kpis.provision_horizon_cents`.
   O front nunca soma eventos por conta própria — apenas consome a RPC.
