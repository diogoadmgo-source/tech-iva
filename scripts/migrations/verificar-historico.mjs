#!/usr/bin/env node
/**
 * verificar-historico.mjs — confere se supabase/migrations/ está coerente consigo
 * mesmo e, opcionalmente, com o histórico de um banco. NÃO altera nada: no banco,
 * só lê supabase_migrations.schema_migrations dentro de uma transação somente leitura.
 *
 * Confere:
 *   1. nome de arquivo no formato AAAAMMDDHHMMSS_descricao.sql;
 *   2. nenhuma versão repetida;
 *   3. nenhuma descrição repetida com versões diferentes (foi assim que surgiram
 *      as duplicatas retiradas em 17/11/2026, ver docs/historico-migrations/);
 *   4. com um banco: o que seria aplicado (arquivo sem registro), o que está fora
 *      de ordem (versão anterior à última registrada) e o que está registrado sem
 *      arquivo. É a mesma conta que o `supabase db push --dry-run` faz, sem a
 *      senha do CLI. O dry-run do CLI continua sendo a conferência oficial.
 *
 * Uso:
 *   node scripts/migrations/verificar-historico.mjs                      # só o repositório
 *   node scripts/migrations/verificar-historico.mjs --versoes lista.txt  # contra uma lista (1 versão por linha)
 *   DATABASE_URL="postgresql://..." node scripts/migrations/verificar-historico.mjs   # contra o banco
 *
 * Sai com código 1 se houver repetição, arquivo fora de ordem ou registro sem arquivo.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, "supabase", "migrations");

const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const problemas = [];

const porVersao = new Map();
const porNome = new Map();
for (const f of arquivos) {
  const m = /^(\d{14})_(.+)\.sql$/.exec(f);
  if (!m) {
    problemas.push(`nome fora do formato AAAAMMDDHHMMSS_descricao.sql: ${f}`);
    continue;
  }
  const [, versao, nome] = m;
  if (porVersao.has(versao)) problemas.push(`versão repetida ${versao}: ${porVersao.get(versao)} e ${f}`);
  porVersao.set(versao, f);
  const lista = porNome.get(nome) ?? [];
  lista.push(f);
  porNome.set(nome, lista);
}
for (const [nome, lista] of porNome) {
  if (lista.length > 1) problemas.push(`descrição "${nome}" repetida com versões diferentes: ${lista.join(", ")}`);
}

console.log(`${arquivos.length} arquivos em supabase/migrations/`);

let registradas = null;
const iVersoes = process.argv.indexOf("--versoes");
if (iVersoes > 0) {
  registradas = readFileSync(process.argv[iVersoes + 1], "utf8")
    .split(/\s+/)
    .filter((v) => /^\d{14}$/.test(v));
  console.log(`${registradas.length} versões lidas de ${process.argv[iVersoes + 1]}`);
} else if (process.env.DATABASE_URL) {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin transaction read only");
    const { rows } = await client.query("select version from supabase_migrations.schema_migrations order by version");
    await client.query("rollback");
    registradas = rows.map((r) => r.version);
  } finally {
    await client.end();
  }
  console.log(`${registradas.length} versões registradas no banco`);
}

if (registradas) {
  const reg = new Set(registradas);
  const ultima = registradas.reduce((a, b) => (b > a ? b : a), "");
  const pendentes = [...porVersao.keys()].filter((v) => !reg.has(v)).sort();
  const semArquivo = registradas.filter((v) => !porVersao.has(v));
  console.log(`última versão registrada: ${ultima || "(nenhuma)"}`);
  console.log(`seriam aplicadas (${pendentes.length}):`);
  for (const v of pendentes) {
    const fora = v < ultima;
    console.log(`  ${porVersao.get(v)}${fora ? "   <- FORA DE ORDEM" : ""}`);
    if (fora) problemas.push(`fora de ordem (anterior à última registrada): ${porVersao.get(v)}`);
  }
  for (const v of semArquivo) problemas.push(`registrada no banco sem arquivo no repositório: ${v}`);
}

if (problemas.length) {
  console.log(`\nPROBLEMAS (${problemas.length}):`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nOK: nenhum problema encontrado.");
