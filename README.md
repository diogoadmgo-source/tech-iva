# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

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
