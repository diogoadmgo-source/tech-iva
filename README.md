# TECH-IVA

Projeto: TECH-IVA — SaaS multi-tenant hierárquico para PMEs (platform > channel > company > unit).

Você vai construir o backend e o front. Comece SÓ pela fundação; nenhuma tela de negócio ainda.

PASSO 1 — Banco (Lovable Cloud / Supabase). Aplique EXATAMENTE as migrations 0001, 0002 e 0003

do documento 01 em anexo (seções 1.1, 1.2, 1.3): extensões ltree/pgcrypto/citext, enums,

tabelas tenants (parent_id + path ltree via trigger), profiles, memberships, invitations,

plans, subscriptions, rule_versions, api_keys, audit_log; funções auth_scopes(), in_scope(),

role_in(), is_platform(), can_admin(); RLS em TODAS as tabelas conforme o documento

(leitura no próprio tenant e descendentes; escrita só no próprio; nenhuma política com

"true" para escrita; audit_log sem update/delete). Não invente colunas, não simplifique

as políticas, não use tenant_id simples no lugar da hierarquia por ltree.

PASSO 2 — Aplique as migrations 0004 (RPCs invite_user, accept_invitation, set_member_role,

remove_member, create_tenant, move_tenant) e 0005 (log_audit + trigger audit_row),

e o seed 0006 (platform FLUXA → channel Gestcom → company Hospcom → unit Filial DF;

company Empresa Teste B; planos; 5 usuários de teste com os papéis indicados).

PASSO 3 — Auth: e-mail/senha + magic link, confirmação obrigatória, trigger que cria

profiles, MFA TOTP obrigatório para papéis platform_* e channel_admin.

PASSO 4 — Só depois disso, telas de auth: /login /signup /forgot /reset /confirm

/invite/:token (usa RPC accept_invitation) /mfa /select-tenant. Visual: dark premium,

Inter + JetBrains Mono, cartão centralizado em superfície elevada, sem ilustrações.

Ao terminar, me devolva: lista das tabelas com RLS ativa, lista das políticas por tabela,

e o resultado destes testes rodados com os 5 usuários do seed:

(a) select * from tenants — cada usuário deve ver só o seu escopo;

(b) usuário finance tentando invite_user → deve falhar;

(c) remove_member do último owner → deve falhar;

(d) update audit_log → deve falhar;

(e) create_tenant(unit sob channel) → deve falhar.

Se algo do documento não puder ser feito exatamente, PARE e me pergunte antes de adaptar.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/855fd1d6-ffd5-4396-8e4c-6ec320982648).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
