// Teste da CNPJá para a opção do Simples pelo regime regular de IBS/CBS.
// O repositório é público: o log NUNCA mostra CNPJ, nome ou endereço; só
// status HTTP, a estrutura da resposta e totais. Lê os alvos com o papel
// tax_ingestor (tax_ingest_simples_targets, migration 0254); não grava nada.
import { readFile } from "node:fs/promises";

const N = Math.min(Number(process.env.CNPJA_TESTE_N ?? 12), 15);
const KEY = process.env.CNPJA_API_KEY;
const DB = process.env.TAX_INGESTOR_DATABASE_URL;
if (!KEY || !DB) throw new Error("faltam CNPJA_API_KEY ou TAX_INGESTOR_DATABASE_URL");

const pg = (await import("pg")).default;
const ca = await readFile(new URL("../executor/supabase-root-2021-ca.crt", import.meta.url), "utf8");
const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: true, ca } });
await db.connect();
let alvos;
try {
  // Espalha a amostra pela base (não só as primeiras raízes).
  const { rows } = await db.query("select cnpj from tax_ingest_simples_targets(null, 5000)");
  const passo = Math.max(1, Math.floor(rows.length / N));
  alvos = rows.filter((_, i) => i % passo === 0).slice(0, N).map((r) => r.cnpj);
  console.log(`optantes do Simples na base (por raiz): ${rows.length}; amostra: ${alvos.length}`);
} catch (e) {
  console.log(`não foi possível ler os alvos (a migration 0254 já foi aplicada?): ${e.message}`);
  process.exit(1);
} finally {
  await db.end();
}

// Troca valores por tipos, para mostrar a estrutura sem dado da empresa.
const forma = (v) =>
  Array.isArray(v) ? (v.length ? [forma(v[0]), `(${v.length} itens)`] : [])
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, forma(x)]))
  : v === null ? null : typeof v;

const tally = new Map();
const conta = (k) => tally.set(k, (tally.get(k) ?? 0) + 1);
let estrutura = false;
for (const [i, cnpj] of alvos.entries()) {
  const url = `https://api.cnpja.com/office/${cnpj}?simples=true&simplesHistory=true`;
  const r = await fetch(url, { headers: { Authorization: KEY } });
  const txt = await r.text();
  console.log(`#${i + 1}: HTTP ${r.status}`);
  if (r.status === 401 || r.status === 403) { console.log("chave recusada; parando."); break; }
  if (r.status === 429) { console.log("limite de créditos/requisições; parando."); break; }
  if (!r.ok) { console.log(`  erro: ${txt.slice(0, 200).replace(/\d{8,}/g, "…")}`); continue; }
  const j = JSON.parse(txt);
  const s = j?.company?.simples ?? null;
  if (!estrutura) {
    console.log("estrutura de company.simples:", JSON.stringify(forma(s), null, 1));
    estrutura = true;
  }
  conta(`simples.optant=${s?.optant}`);
  conta(`simei.optant=${j?.company?.simei?.optant}`);
  const ev = Array.isArray(s?.events) ? s.events : [];
  conta(`eventos IBS/CBS: ${ev.length ? "tem" : "nenhum"}`);
  // Os eventos não têm dado da empresa: mostra tipo e datas.
  for (const e of ev) console.log("  evento:", JSON.stringify(e));
  for (const k of Object.keys(s ?? {})) if (/ibs|cbs|regular/i.test(k)) console.log(`  campo ${k}:`, JSON.stringify(s[k]));
  await new Promise((ok) => setTimeout(ok, 1500));
}
console.log("totais:", Object.fromEntries(tally));
