# Migrations — fonte da verdade

O banco do projeto Supabase `lfufwoirpwlsdmststbr` tem **106 migrations** registradas em
`supabase_migrations.schema_migrations`. Este diretório continha só as 44 de nome-UUID
(geradas pelo Lovable). As 61 nomeadas (`0001_control_plane` … `0159_devolver_cota_em_falha_local`)
e a `split_premissas_antecipacao` foram aplicadas por MCP e precisam viver aqui também.

**Regra:** toda mudança de schema entra por `apply_migration` (Supabase MCP) *e* é
comitada aqui com o mesmo texto. Nunca só um dos dois.

Para trazer o que falta (uma vez, ou sempre que suspeitar de desvio):

```bash
npm i -D pg
DATABASE_URL="postgresql://postgres.lfufwoirpwlsdmststbr:<SENHA>@aws-0-<REGIAO>.pooler.supabase.com:5432/postgres" \
node scripts/sync-migrations.mjs
git add supabase/migrations && git commit -m "chore(db): baseline — migrations exportadas do Supabase"
```
