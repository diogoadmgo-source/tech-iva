#!/usr/bin/env node
// Motor de consulta tributária em massa: cruza as carteiras com os arquivos
// públicos da Receita (Dados Abertos do CNPJ e regime tributário da ECF).
//
// Uso:
//   node scripts/tax-intel/executor/run.mjs [opções]
//
//   --competencia AAAA-MM   competência dos Dados Abertos (padrão: a mais recente publicada)
//   --datasets a,b          receita_simples,receita_empresas,receita_estabelecimentos,receita_regime_tributario
//   --sonda                 sem banco: baixa, confere layout e mede; cruza só a --amostra-publica
//   --amostra-publica       CNPJs de grandes empresas públicas, únicos que podem aparecer no log
//   --alvos arquivo.txt     (sem banco) CNPJs-alvo, um por linha; o log mostra só agregados
//   --fonte-local DIR       lê DIR/AAAA-MM/*.zip e DIR/regime_tributario/*.zip em vez da internet (testes)
//   --relatorio arq.json    grava o relatório local (na carga, nunca publicado como artefato)
//   --tmp DIR               pasta temporária dos downloads (padrão: tmp do sistema)
//
// Com banco: TAX_INGESTOR_DATABASE_URL (papel tax_ingestor, nunca service_role).
//
// Regra de log: nenhum CNPJ da carteira é impresso. Só agregados, nomes de
// arquivos públicos e, na sonda, os CNPJs da amostra pública.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { listZip, openMember } from "./zip.mjs";
import { lineBatches, parseLine, firstField } from "./csv.mjs";
import { DATASETS, regimeHeader, isRaiz } from "./layouts.mjs";
import { cnpjValid, cnpjStrip } from "./cnpj.mjs";

export const BASE_CNPJ = "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/";
export const BASE_REGIME = "https://arquivos.receitafederal.gov.br/dados/cnpj/regime_tributario/";
// Grandes empresas de capital aberto/estatais: dado público, pode aparecer no log da sonda.
export const AMOSTRA_PUBLICA = ["00000000000191", "33000167000101", "00360305000104", "60701190000104"];
const ORDER = ["receita_simples", "receita_empresas", "receita_estabelecimentos", "receita_regime_tributario"];
const BATCH = 1000;
const UA = "techiva-tax-intel-executor/1.0";

function parseArgs(argv) {
  const a = { datasets: ORDER.slice() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--competencia") a.competencia = next();
    else if (k === "--datasets") a.datasets = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--sonda") a.sonda = true;
    else if (k === "--amostra-publica") a.amostra = true;
    else if (k === "--alvos") a.alvos = next();
    else if (k === "--fonte-local") a.local = next();
    else if (k === "--relatorio") a.relatorio = next();
    else if (k === "--tmp") a.tmp = next();
    else if (k === "--base-cnpj") a.baseCnpj = next();
    else if (k === "--base-regime") a.baseRegime = next();
    else throw new Error(`opção desconhecida: ${k}`);
  }
  for (const d of a.datasets) if (!ORDER.includes(d)) throw new Error(`conjunto desconhecido: ${d}`);
  a.datasets = ORDER.filter((d) => a.datasets.includes(d));
  return a;
}

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

// ---------------------------------------------------------------- origem
async function fetchText(url) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
      return await r.text();
    } catch (e) {
      if (t >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * t * t));
    }
  }
}

/** Links de uma listagem HTML de diretório (Apache/nginx). */
export function parseListing(html) {
  const out = [];
  for (const m of html.matchAll(/href="([^"?#]+)"/gi)) {
    const h = decodeURIComponent(m[1]);
    if (h.startsWith("/") || h.startsWith("..") || /^[a-z]+:/i.test(h)) continue;
    out.push(h);
  }
  return [...new Set(out)];
}

class Origin {
  constructor(a) {
    this.local = a.local;
    this.baseCnpj = a.baseCnpj ?? BASE_CNPJ;
    this.baseRegime = a.baseRegime ?? BASE_REGIME;
  }
  async months() {
    const names = this.local
      ? (await readdir(this.local)).map((n) => `${n}/`)
      : parseListing(await fetchText(this.baseCnpj));
    return names.filter((n) => /^\d{4}-\d{2}\/$/.test(n)).map((n) => n.slice(0, 7)).sort();
  }
  async files(kind, competencia) {
    if (this.local) {
      const dir = kind === "regime" ? join(this.local, "regime_tributario") : join(this.local, competencia);
      return (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".zip")).sort().map((n) => ({ name: n, url: join(dir, n) }));
    }
    const base = kind === "regime" ? this.baseRegime : `${this.baseCnpj}${competencia}/`;
    return parseListing(await fetchText(base))
      .filter((n) => n.toLowerCase().endsWith(".zip"))
      .sort()
      .map((n) => ({ name: basename(n), url: new URL(n, base).toString() }));
  }
  async entries(kind) {
    if (this.local) return readdir(kind === "regime" ? join(this.local, "regime_tributario") : this.local);
    return parseListing(await fetchText(kind === "regime" ? this.baseRegime : this.baseCnpj));
  }
  /** Baixa para disco (ou usa o arquivo local) e devolve { path, size, sha256 }. */
  async fetchFile(f, tmp, stats) {
    if (this.local) {
      const buf = await readFile(f.url);
      return { path: f.url, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), local: true };
    }
    const path = join(tmp, f.name);
    for (let t = 1; ; t++) {
      try {
        const r = await fetch(f.url, { headers: { "user-agent": UA } });
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} em ${f.name}`);
        const h = createHash("sha256");
        let size = 0, next = 256 * 1048576;
        const meter = new Transform({
          transform(chunk, _e, cb) {
            h.update(chunk); size += chunk.length;
            if (size >= next) { log(`  ${f.name}: ${mb(size)} baixados`); next += 256 * 1048576; }
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(r.body), meter, createWriteStream(path));
        stats.bytes_downloaded += size;
        stats.peak_disk_bytes = Math.max(stats.peak_disk_bytes, size);
        return { path, size, sha256: h.digest("hex") };
      } catch (e) {
        await rm(path, { force: true });
        if (t >= 4) throw e;
        log(`  ${f.name}: falha (${e.message}); nova tentativa ${t + 1}/4`);
        await new Promise((ok) => setTimeout(ok, 5000 * t * t));
      }
    }
  }
}

// ---------------------------------------------------------------- destino
class NoDb {
  constructor(targets) { this.targets = targets; this.rows = new Map(); }
  async start() { return { run_id: null, targets: this.targets.size }; }
  async loadTargets() { return this.targets; }
  async file() { return 0; }
  async batch(source, rows) {
    const m = this.rows.get(source) ?? new Map();
    let inserted = 0;
    for (const r of rows) if (!m.has(r.key)) { m.set(r.key, r); inserted++; }
    this.rows.set(source, m);
    return { inserted, cached: rows.length - inserted };
  }
  async classify() { return { done: true, processed: 0 }; }
  async summary() { return null; }
  async finish() {}
  async close() {}
}

class PgDb {
  constructor(url) { this.url = url; }
  async connect() {
    let pg;
    try { pg = (await import("pg")).default; } catch {
      throw new Error("Pacote `pg` não encontrado. Rode `bun install`.");
    }
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(this.url) || /sslmode=disable/.test(this.url);
    this.c = new pg.Client({ connectionString: this.url, ssl: local ? false : { rejectUnauthorized: true } });
    await this.c.connect();
  }
  async q(sql, params) { return (await this.c.query(sql, params)).rows; }
  async start(comp, datasets, ghUrl) {
    const [r] = await this.q("select public.tax_ingest_start_run($1, $2, $3, $4) as v",
      [comp, datasets, process.env.GITHUB_ACTOR ? `github:${process.env.GITHUB_ACTOR}` : "manual", ghUrl ?? null]);
    this.run = r.v.run_id;
    return r.v;
  }
  async loadTargets() {
    const out = new Set();
    let after = null;
    for (;;) {
      const rows = await this.q("select cnpj from public.tax_ingest_targets($1, $2, 20000)", [this.run, after]);
      if (!rows.length) break;
      for (const r of rows) out.add(r.cnpj);
      after = rows[rows.length - 1].cnpj;
    }
    return out;
  }
  async file(name, size, sha, header, scanned, matched, last, status) {
    const [r] = await this.q("select public.tax_ingest_file($1,$2,$3,$4,$5,$6,$7,$8,$9) as v",
      [this.run, name, size, sha, header, scanned, matched, last, status]);
    return Number(r.v);
  }
  async batch(source, rows) {
    const [r] = await this.q("select public.tax_ingest_batch($1, $2, $3::jsonb) as v", [this.run, source, JSON.stringify(rows)]);
    return r.v;
  }
  async classify(after) {
    const [r] = await this.q("select public.tax_ingest_classify($1, $2, 5000) as v", [this.run, after]);
    return r.v;
  }
  async summary() {
    const [r] = await this.q("select public.tax_ingest_summary($1) as v", [this.run]);
    return r.v;
  }
  async finish(status, metrics, error) {
    await this.q("select public.tax_ingest_finish_run($1, $2, $3::jsonb, $4)", [this.run, status, JSON.stringify(metrics), error ?? null]);
  }
  async close() { await this.c?.end(); }
}

class LayoutError extends Error {}

// ---------------------------------------------------------------- varredura
async function scanDataset(ds, ctx) {
  const L = DATASETS[ds];
  const { targets, roots, db, origin, tmp, stats, report } = ctx;
  const want = L.granularity === "raiz" ? roots : targets;
  const found = new Set();
  const files = (await origin.files("cnpj", ctx.competencia)).filter((f) => L.files.test(f.name));
  report.datasets[ds] = { files: [], matched: 0, not_found: 0, inserted: 0, cached: 0 };
  if (!files.length) throw new LayoutError(`${ds}: nenhum arquivo encontrado na competência ${ctx.competencia}`);
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const r = await db.batch(ds, pending);
    report.datasets[ds].inserted += r.inserted;
    report.datasets[ds].cached += r.cached;
    pending = [];
  };
  for (const f of files) {
    const t0 = Date.now();
    const dl = await origin.fetchFile(f, tmp, stats);
    const resumeFrom = await db.file(f.name, dl.size, dl.sha256, null, 0, 0, 0, "processando");
    let n = 0, matched = 0, checked = 0, bad = 0;
    for (const member of await listZip(dl.path)) {
      for await (const batch of lineBatches(openMember(dl.path, member))) {
        for (const line of batch) {
          n++;
          // Conferência de layout nas primeiras 2.000 linhas de cada arquivo.
          if (checked < 2000) {
            checked++;
            const fields = parseLine(line);
            const key = L.keyOf(fields);
            const ok = fields.length === L.columns &&
              (L.granularity === "raiz" ? isRaiz(key) : /^[0-9A-Z]{12}[0-9]{2}$/.test(key));
            if (!ok) bad++;
            if (checked === 2000 || bad > 20) {
              if (bad > 20) throw new LayoutError(`${f.name}: ${bad} de ${checked} linhas fora do layout esperado (${L.columns} colunas)`);
            }
          }
          if (n <= resumeFrom) continue;
          const basico = firstField(line);
          if (!roots.has(basico)) continue;
          const fields = parseLine(line);
          if (fields.length !== L.columns) continue;
          const key = L.keyOf(fields);
          if (!want.has(key) || found.has(key)) continue;
          const nrm = L.normalize(fields, ctx);
          if (!nrm) { stats.rejected++; continue; }
          found.add(key);
          matched++;
          pending.push({ key, status: "ok", raw: L.raw(fields), n: nrm });
          if (ctx.publicSample?.has(key) || ctx.publicSample?.has(key.slice(0, 8))) report.sample[ds] = { ...(report.sample[ds] ?? {}), [key]: nrm };
          if (pending.length >= BATCH) {
            await flush();
            await db.file(f.name, null, null, null, n, matched, n, "processando");
          }
        }
      }
    }
    if (checked > 0 && bad / checked > 0.01) {
      throw new LayoutError(`${f.name}: ${bad} de ${checked} linhas fora do layout esperado (${L.columns} colunas)`);
    }
    await flush();
    await db.file(f.name, null, null, null, n, matched, n, "concluido");
    stats.rows_scanned += n;
    stats.rows_matched += matched;
    report.datasets[ds].files.push({ name: f.name, size: dl.size, sha256: dl.sha256, rows: n, matched,
      layout_checked: checked, layout_bad: bad, seconds: Math.round((Date.now() - t0) / 1000) });
    log(`${ds} · ${f.name}: ${mb(dl.size)}, ${n.toLocaleString("pt-BR")} linhas, ${matched} da carteira, ${Math.round((Date.now() - t0) / 1000)} s`);
    if (!dl.local) await rm(dl.path, { force: true });
  }
  // Varredura completa: o que não apareceu é "não encontrado" naquela competência.
  for (const key of want) {
    if (found.has(key)) continue;
    pending.push({ key, status: "nao_encontrado" });
    report.datasets[ds].not_found++;
    if (pending.length >= BATCH) await flush();
  }
  await flush();
  report.datasets[ds].matched = found.size;
}

async function scanRegime(ctx) {
  const { targets, db, origin, tmp, stats, report } = ctx;
  const ds = "receita_regime_tributario";
  const files = await origin.files("regime", ctx.competencia);
  report.datasets[ds] = { files: [], matched: 0, not_found: 0, inserted: 0, cached: 0 };
  if (!files.length) {
    const entries = await origin.entries("regime").catch((e) => [`(listagem falhou: ${e.message})`]);
    throw new LayoutError(`regime tributário: nenhum .zip na pasta publicada; itens: ${entries.slice(0, 30).join(", ")}`);
  }
  const acc = new Map(); // cnpj -> linhas
  for (const f of files) {
    const t0 = Date.now();
    const dl = await origin.fetchFile(f, tmp, stats);
    await db.file(f.name, dl.size, dl.sha256, null, 0, 0, 0, "processando");
    let n = 0, matched = 0, idx = null, header = null;
    for (const member of await listZip(dl.path)) {
      let first = true;
      for await (const batch of lineBatches(openMember(dl.path, member))) {
        for (const line of batch) {
          if (first) {
            first = false;
            header = parseLine(line);
            const h = regimeHeader(header);
            if (h.erro) throw new LayoutError(`${f.name}: cabeçalho inesperado (${h.erro}): ${header.join(" | ").slice(0, 300)}`);
            idx = h.idx;
            continue;
          }
          n++;
          const fields = parseLine(line);
          const cnpj = cnpjStrip(fields[idx.cnpj]).padStart(14, "0");
          if (!targets.has(cnpj)) continue;
          const ano = (fields[idx.ano] ?? "").trim();
          const forma = (fields[idx.forma] ?? "").trim();
          if (!/^\d{4}$/.test(ano) || !forma) { stats.rejected++; continue; }
          matched++;
          const l = acc.get(cnpj) ?? [];
          l.push({ ano, forma, cnpj_da_scp: idx.cnpj_da_scp !== undefined ? (fields[idx.cnpj_da_scp] ?? "").trim() : "",
            quantidade: idx.quantidade !== undefined ? (fields[idx.quantidade] ?? "").trim() : "", arquivo: f.name });
          acc.set(cnpj, l);
        }
      }
    }
    await db.file(f.name, null, null, header, n, matched, n, "concluido");
    stats.rows_scanned += n;
    stats.rows_matched += matched;
    report.datasets[ds].files.push({ name: f.name, size: dl.size, sha256: dl.sha256, rows: n, matched, header,
      seconds: Math.round((Date.now() - t0) / 1000) });
    log(`${ds} · ${f.name}: ${mb(dl.size)}, ${n.toLocaleString("pt-BR")} linhas, ${matched} da carteira`);
    if (!dl.local) await rm(dl.path, { force: true });
  }
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const r = await db.batch(ds, pending);
    report.datasets[ds].inserted += r.inserted;
    report.datasets[ds].cached += r.cached;
    pending = [];
  };
  for (const cnpj of targets) {
    const linhas = acc.get(cnpj);
    if (linhas) {
      pending.push({ key: cnpj, status: "ok", raw: { linhas }, n: { linhas: linhas.map(({ arquivo, ...r }) => r) } });
      if (ctx.publicSample?.has(cnpj)) report.sample[ds] = { ...(report.sample[ds] ?? {}), [cnpj]: linhas };
    } else {
      pending.push({ key: cnpj, status: "nao_encontrado" });
      report.datasets[ds].not_found++;
    }
    if (pending.length >= BATCH) await flush();
  }
  await flush();
  report.datasets[ds].matched = acc.size;
}

async function loadMunicipios(ctx) {
  const f = (await ctx.origin.files("cnpj", ctx.competencia)).find((x) => /^municipios\.zip$/i.test(x.name));
  const map = new Map();
  if (!f) return map;
  const dl = await ctx.origin.fetchFile(f, ctx.tmp, ctx.stats);
  for (const member of await listZip(dl.path))
    for await (const batch of lineBatches(openMember(dl.path, member)))
      for (const line of batch) { const [c, d] = parseLine(line); if (c) map.set(c.trim(), (d ?? "").trim()); }
  if (!dl.local) await rm(dl.path, { force: true });
  return map;
}

// ---------------------------------------------------------------- principal
export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  const t0 = Date.now();
  const origin = new Origin(a);
  const stats = { bytes_downloaded: 0, peak_disk_bytes: 0, rows_scanned: 0, rows_matched: 0, rejected: 0 };
  const report = { competencia: null, modo: a.sonda ? "sonda" : process.env.TAX_INGESTOR_DATABASE_URL ? "banco" : "sem-banco",
    datasets: {}, sample: {}, stats };
  const tmp = await mkdtemp(join(a.tmp ?? tmpdir(), "tax-intel-"));

  const months = await origin.months();
  if (!months.length) throw new Error("nenhuma competência publicada encontrada na origem");
  const competencia = a.competencia ?? months[months.length - 1];
  if (!months.includes(competencia)) throw new Error(`competência ${competencia} não publicada (há: ${months.slice(-6).join(", ")})`);
  report.competencia = competencia;
  report.competencias_publicadas = months.slice(-6);
  log(`competência ${competencia} (publicadas: ${months.slice(-6).join(", ")})`);

  let db;
  let targets;
  const useDb = !a.sonda && !a.alvos && process.env.TAX_INGESTOR_DATABASE_URL;
  if (useDb) {
    db = new PgDb(process.env.TAX_INGESTOR_DATABASE_URL);
    await db.connect();
    const r = await db.start(competencia, a.datasets, process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null);
    targets = await db.loadTargets();
    log(`execução ${r.run_id}${r.retomada ? " (retomada)" : ""}: ${targets.size.toLocaleString("pt-BR")} CNPJs distintos nas carteiras`);
  } else {
    const list = a.alvos ? (await readFile(a.alvos, "utf8")).split(/\r?\n/).map(cnpjStrip).filter(Boolean) : [];
    if (a.amostra || a.sonda) list.push(...AMOSTRA_PUBLICA);
    const invalid = list.filter((c) => !cnpjValid(c)).length;
    targets = new Set(list.filter(cnpjValid));
    db = new NoDb(targets);
    log(`sem banco: ${targets.size} CNPJs-alvo${invalid ? ` (${invalid} inválidos descartados)` : ""}`);
  }
  const roots = new Set([...targets].map((c) => c.slice(0, 8)));
  const ctx = { targets, roots, db, origin, tmp, stats, report, competencia,
    publicSample: a.sonda || a.amostra ? new Set([...AMOSTRA_PUBLICA, ...AMOSTRA_PUBLICA.map((c) => c.slice(0, 8))]) : null };

  let status = "concluida", error = null;
  try {
    if (a.datasets.includes("receita_estabelecimentos")) ctx.municipios = await loadMunicipios(ctx);
    for (const ds of a.datasets) {
      if (ds === "receita_regime_tributario") await scanRegime(ctx);
      else await scanDataset(ds, ctx);
    }
    if (useDb) {
      let after = null, total = 0, changed = 0;
      for (;;) {
        const r = await db.classify(after);
        if (r.done) break;
        total += r.processed; changed += r.changed; after = r.last;
      }
      report.classificacao = { processados: total, alterados: changed };
      log(`classificação: ${total} CNPJs, ${changed} com classe alterada`);
      report.banco = await db.summary();
      log("no banco", JSON.stringify(report.banco));
    }
  } catch (e) {
    status = e instanceof LayoutError ? "abortada_layout" : "falhou";
    error = e.message;
    log(`ERRO (${status}): ${e.message}`);
  }
  stats.duration_seconds = Math.round((Date.now() - t0) / 1000);
  stats.runner_minutes = +(stats.duration_seconds / 60).toFixed(2);
  try { await db.finish(status, { ...stats, report: { datasets: report.datasets } }, error); } finally { await db.close(); }
  await rm(tmp, { recursive: true, force: true });
  report.status = status;
  report.error = error;
  if (a.relatorio) await writeFile(a.relatorio, JSON.stringify(report, null, 2));
  // Resumo: só agregados (e a amostra pública, quando pedida).
  log("resumo", JSON.stringify({ status, competencia, stats,
    datasets: Object.fromEntries(Object.entries(report.datasets).map(([k, v]) => [k, {
      arquivos: v.files.length, casados_nesta_passagem: v.matched, enviados_como_nao_encontrados: v.not_found,
      gravados: v.inserted, ja_existiam: v.cached }])) }));
  if (ctx.publicSample) log("amostra pública", JSON.stringify(report.sample));
  if (status !== "concluida") process.exitCode = 1;
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
