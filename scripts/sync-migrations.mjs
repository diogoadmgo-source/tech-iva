#!/usr/bin/env node
/**
 * sync-migrations.mjs — traz para o repositório TODAS as migrations registradas
 * no Supabase (supabase_migrations.schema_migrations) que ainda não existem em
 * supabase/migrations/. Não altera o banco: só lê e grava arquivos.
 *
 * Por quê: 106 migrations foram aplicadas no projeto (Lovable + MCP), mas só as
 * 44 com nome-UUID do Lovable chegaram ao repo. As 61 nomeadas (0001_control_plane
 * ... 0159_devolver_cota_em_falha_local) só existem no banco. Sem elas o schema
 * não é reconstruível a partir do Git.
 *
 * Uso:
 *   DATABASE_URL="postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres" \
 *   node scripts/sync-migrations.mjs
 *
 * A URL vem de: Supabase → Project Settings → Database → Connection string →
 * "Session pooler" (porta 5432). Use a senha do banco, não a anon key.
 */
import { mkdirSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");
mkdirSync(dir, { recursive: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL (Session pooler, porta 5432).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(
  `select version, name, array_to_string(statements, E'\\n') as sql
     from supabase_migrations.schema_migrations
    order by version`
);
await client.end();

const existing = new Set(readdirSync(dir).map((f) => f.replace(/\.sql$/, "").split("_")[0]));
let written = 0;
for (const r of rows) {
  if (existing.has(r.version)) continue;
  const safe = r.name.replace(/[^A-Za-z0-9_-]+/g, "_");
  const file = join(dir, `${r.version}_${safe}.sql`);
  writeFileSync(file, `-- Migration ${r.version} (${r.name}) — exportada de supabase_migrations.schema_migrations\n${r.sql}\n`);
  written++;
  console.log("gravado", file.replace(root + "/", ""));
}
console.log(`\n${rows.length} migrations no banco · ${written} novas gravadas · ${rows.length - written} já existiam.`);
