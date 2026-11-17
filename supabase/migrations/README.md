# Migrations — fonte da verdade

Esta pasta é o histórico executável do banco. Cada arquivo `AAAAMMDDHHMMSS_descricao.sql`
corresponde a uma linha de `supabase_migrations.schema_migrations` no projeto
`lfufwoirpwlsdmststbr` (fluxa-dev), com a **mesma versão**.

Conferido em 17/11/2026: os 139 arquivos desta pasta e as 138 versões do fluxa-dev batem,
menos a `20260926030000` (0235), que ainda não foi aplicada. Evidência em
`docs/historico-migrations/evidencias/`.

## Procedimento oficial: Supabase CLI

1. Crie o arquivo aqui, com o carimbo de data e hora atual:
   `supabase migration new descricao` (ou à mão, no mesmo formato).
2. Confira o repositório: `node scripts/migrations/verificar-historico.mjs`.
3. Ligue o projeto uma vez por máquina: `supabase link --project-ref lfufwoirpwlsdmststbr`.
4. Veja exatamente o que seria aplicado, sem aplicar:
   `supabase db push --dry-run`. A lista tem que ter só as migrations novas.
5. Aplique: `supabase db push`. O CLI grava a versão do próprio arquivo no histórico.
6. Confira: `supabase migration list` mostra a mesma versão nos dois lados.

Regras:

* **Não aplique migration pelo MCP (`apply_migration`) nem colando no SQL Editor.** O MCP
  grava a hora da aplicação como versão, diferente da do arquivo. Foi isso que criou as duas
  duplicatas retiradas em 17/11/2026 (`docs/historico-migrations/`). Colar no SQL Editor
  não registra nada, e depois é preciso `migration repair` (foi o caso da 0230 a 0234).
* **Nunca use `supabase db push --include-all` no fluxa-dev.** Ele aplica arquivos com
  versão anterior à última registrada.
* **Não altere migration já aplicada.** Correção é sempre uma migration nova.
* Se o `--dry-run` listar algo inesperado, pare e investigue antes de aplicar.
* A ordem entre publicar o código e aplicar a migration é a que o cabeçalho da migration
  indicar. Sem indicação, vale a regra de `docs/fluxo-de-trabalho.md`.

## Exportar o que só existe no banco

Se algum dia uma migration for aplicada por fora, `scripts/sync-migrations.mjs` traz o texto
registrado no banco para esta pasta, com a versão do banco (só leitura no banco):

```bash
DATABASE_URL="postgresql://postgres.lfufwoirpwlsdmststbr:<SENHA>@aws-0-<REGIAO>.pooler.supabase.com:5432/postgres" \
node scripts/sync-migrations.mjs
```

Depois disso, rode `verificar-historico.mjs` para garantir que não ficou duplicata.
