# Hospedagem na Vercel

O app saiu do Lovable em novembro de 2026. Hoje:

| Peça | Onde |
|---|---|
| App (SSR + rotas de API) | Vercel, projeto ligado a este repositório; build `bun run build` (Nitro, preset `vercel`) |
| Banco, Auth, Edge Functions | Supabase, projeto `TechIVA-Prod` (`lfufwoirpwlsdmststbr`) |
| Pagamentos | Paddle, API direta (`api.paddle.com` / `sandbox-api.paddle.com`) |
| E-mail transacional | Resend, API direta (`api.resend.com`) |
| Domínio | `techiva.com.br` |

## Variáveis de ambiente

Cadastrar em Vercel → Project Settings → Environment Variables. Em *Preview*,
use as chaves de sandbox do Paddle.

**Públicas** (também em `.env`, entram no bundle do navegador):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`,
`VITE_PAYMENTS_CLIENT_TOKEN`, `VITE_TECHIVA_PROCURADOR_CNPJ`.

**Servidor** (nunca no repositório):

| Variável | Para quê |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Acesso ao Supabase no servidor |
| `APP_URL` | URL pública usada nos links dos e-mails (`https://techiva.com.br`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Envio de e-mail |
| `PADDLE_LIVE_API_KEY`, `PADDLE_SANDBOX_API_KEY` | Chave de API do Paddle (Developer Tools → Authentication) |
| `PAYMENTS_LIVE_WEBHOOK_SECRET`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | Segredo do destino de notificação do Paddle |
| `DFE_SECRET_KEY`, `DFE_SECRET_KEY_ID`, `DFE_SECRET_KEY_PREVIOUS`, `DFE_SECRET_KEY_PREVIOUS_ID` | Chave mestra que cifra as credenciais dos clientes. **Nunca trocar o valor sem rotação** (ver `src/lib/credentials.server.ts`) |
| `CRON_SECRET` | Protege `/api/public/cron/weekly-digest` |
| `CNPJ_API_URL`, `CNPJ_API_KEY` | Consulta de CNPJ |
| `RTC_API_URL`, `RTC_API_PREFIX`, `RTC_API_VERSAO`, `RTC_APURACAO_URL`, `RTC_CALC_URL`, `RTC_CALC_API_KEY`, `RTC_TOKEN_URL`, `RTC_TOKEN_AUTH`, `RTC_DEFAULT_MUNICIPIO` | Integração com a Receita (RTC). Todas têm padrão no código; só defina se precisar mudar |

## Webhooks e agendamentos

- Paddle → `https://techiva.com.br/api/public/payments/webhook?env=live` (e `?env=sandbox` para a conta de testes). Sem `?env=live`, o evento é tratado como sandbox.
- Receita (apuração RTC) → o `urlRetorno` é montado com o domínio da própria requisição, nada a configurar.
- Resumo semanal: o endpoint aceita `Authorization: Bearer <CRON_SECRET>`, o formato do Vercel Cron. Ainda **não** há agendamento; para ligar, adicionar em `vercel.json`:
  `"crons": [{ "path": "/api/public/cron/weekly-digest", "schedule": "0 11 * * *" }]`
  (diário; a RPC escolhe os tenants pelo dia da semana configurado).

## Supabase Auth

Authentication → URL Configuration: Site URL `https://techiva.com.br`, e nas
Redirect URLs `https://techiva.com.br/**` e `https://*-diogoadmgo-source.vercel.app/**`.
