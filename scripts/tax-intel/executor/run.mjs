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
//   --cache DIR             guarda os arquivos baixados em DIR e reaproveita os que já estão lá
//                           (o workflow guarda DIR no cache do GitHub, por publicação da Receita)
//
// Com banco: TAX_INGESTOR_DATABASE_URL (papel tax_ingestor, nunca service_role).
//
// Regra de log: nenhum CNPJ da carteira é impresso. Só agregados, nomes de
// arquivos públicos e, na sonda, os CNPJs da amostra pública.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { listZip, openMember } from "./zip.mjs";
import { lineBatches, parseLine, firstField } from "./csv.mjs";
import { DATASETS, regimeHeader, isRaiz } from "./layouts.mjs";
import { cnpjValid, cnpjStrip } from "./cnpj.mjs";

// Desde nov/2026 a Receita publica num compartilhamento público do Nextcloud:
// a raiz do site redireciona para index.php/s/<token>, e as pastas são lidas
// pelo WebDAV público (usuário = token, senha vazia). As URLs antigas
// (/dados/cnpj/dados_abertos_cnpj/ e /dados/cnpj/regime_tributario/) dão 404.
export const RECEITA_SITE = "https://arquivos.receitafederal.gov.br/";
export const DAV_ROOT = "https://arquivos.receitafederal.gov.br/public.php/webdav";
export const PATH_CNPJ = "/Dados/Cadastros/CNPJ/";
export const PATH_REGIME = "/Dados/Obrigacoes_Acessorias/ECF/";
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
    else if (k === "--publicacao") a.publicacao = next();
    else if (k === "--amostra-publica") a.amostra = true;
    else if (k === "--alvos") a.alvos = next();
    else if (k === "--fonte-local") a.local = next();
    else if (k === "--relatorio") a.relatorio = next();
    else if (k === "--tmp") a.tmp = next();
    else if (k === "--cache") a.cache = next();
    else if (k === "--token-receita") a.token = next();
    else throw new Error(`opção desconhecida: ${k}`);
  }
  for (const d of a.datasets) if (!ORDER.includes(d)) throw new Error(`conjunto desconhecido: ${d}`);
  a.datasets = ORDER.filter((d) => a.datasets.includes(d));
  return a;
}

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const IDLE_MS = 120_000;
const MAX_TRIES = 12;
/** Nome do arquivo no cache: o caminho público inteiro, para não misturar competências. */
export const cacheName = (url) => decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "_");
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

// ---------------------------------------------------------------- origem
async function fetchText(url, init = {}) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
      return await r.text();
    } catch (e) {
      if (t >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * t * t));
    }
  }
}

/** Nomes (pastas terminam em "/") de uma resposta PROPFIND Depth 1, sem a própria pasta. */
export function parsePropfind(xml, dirPath) {
  const out = [];
  for (const m of xml.matchAll(/<d:href>([^<]+)<\/d:href>/gi)) {
    const href = decodeURIComponent(m[1]);
    const i = href.indexOf(dirPath);
    if (i < 0) continue;
    const rest = href.slice(i + dirPath.length);
    if (!rest || rest.slice(0, -1).includes("/")) continue;
    out.push(rest);
  }
  return [...new Set(out)];
}

/** Como parsePropfind, mas com o ETag de cada item (muda quando o arquivo muda). */
export function parsePropfindEtags(xml, dirPath) {
  const out = {};
  for (const m of xml.matchAll(/<d:response>([\s\S]*?)<\/d:response>/gi)) {
    const href = /<d:href>([^<]+)<\/d:href>/i.exec(m[1]);
    if (!href) continue;
    const full = decodeURIComponent(href[1]);
    const i = full.indexOf(dirPath);
    if (i < 0) continue;
    const rest = full.slice(i + dirPath.length);
    if (!rest || rest.slice(0, -1).includes("/")) continue;
    const etag = /<d:getetag>([^<]*)<\/d:getetag>/i.exec(m[1]);
    out[rest] = etag ? etag[1].replace(/&quot;|"/g, "") : "";
  }
  return out;
}

// Regime declarado na ECF: um arquivo por forma de tributação.
export const REGIME_FILE = /^entidades-lucro-(real|presumido|arbitrado)\.zip$/i;

export class Origin {
  constructor(a) {
    this.local = a.local;
    this.token = a.token ?? process.env.RECEITA_SHARE_TOKEN;
    this.cache = a.cache ?? null;
  }
  async auth() {
    if (!this.token) {
      // Descobre o token pelo redirecionamento da raiz do site.
      const r = await fetch(RECEITA_SITE, { headers: { "user-agent": UA }, redirect: "follow" });
      const m = /\/index\.php\/s\/([A-Za-z0-9]+)/.exec(r.url);
      if (!m) throw new Error(`não achei o compartilhamento público da Receita (raiz foi para ${r.url}, HTTP ${r.status})`);
      this.token = m[1];
      log(`origem: compartilhamento público ${r.url}`);
    }
    return { authorization: `Basic ${Buffer.from(`${this.token}:`).toString("base64")}` };
  }
  async list(path) {
    const xml = await fetchText(`${DAV_ROOT}${path}`, { method: "PROPFIND", headers: { depth: "1", ...(await this.auth()) } });
    return parsePropfind(xml, `/public.php/webdav${path}`);
  }
  /**
   * Impressão digital do que a Receita publicou (sem baixar nada): competência
   * mais recente do CNPJ + ETag de cada arquivo dela e dos arquivos do regime.
   * Muda quando sai competência nova ou quando um arquivo é republicado.
   */
  async publicacao() {
    const dav = async (path) => parsePropfindEtags(
      await fetchText(`${DAV_ROOT}${path}`, { method: "PROPFIND", headers: { depth: "1", ...(await this.auth()) } }),
      `/public.php/webdav${path}`);
    const months = await this.months();
    const competencia = months[months.length - 1];
    const cnpj = await dav(`${PATH_CNPJ}${competencia}/`);
    const regime = Object.fromEntries(Object.entries(await dav(PATH_REGIME)).filter(([n]) => REGIME_FILE.test(n)));
    const linhas = (o) => Object.keys(o).sort().map((k) => `${k}=${o[k]}`);
    const body = [`competencia=${competencia}`, ...linhas(cnpj), ...linhas(regime)].join("\n");
    return { competencia, arquivos_cnpj: Object.keys(cnpj).length, arquivos_regime: Object.keys(regime),
      impressao: createHash("sha256").update(body).digest("hex").slice(0, 32) };
  }
  async months() {
    const names = this.local ? (await readdir(this.local)).map((n) => `${n}/`) : await this.list(PATH_CNPJ);
    return names.filter((n) => /^\d{4}-\d{2}\/$/.test(n)).map((n) => n.slice(0, 7)).sort();
  }
  async files(kind, competencia) {
    const keep = (n) => (kind === "regime" ? REGIME_FILE.test(n) : n.toLowerCase().endsWith(".zip"));
    if (this.local) {
      const dir = kind === "regime" ? join(this.local, "regime_tributario") : join(this.local, competencia);
      return (await readdir(dir)).filter(keep).sort().map((n) => ({ name: n, url: join(dir, n) }));
    }
    const path = kind === "regime" ? PATH_REGIME : `${PATH_CNPJ}${competencia}/`;
    return (await this.list(path)).filter(keep).sort()
      .map((n) => ({ name: n, url: `${DAV_ROOT}${path}${encodeURIComponent(n)}` }));
  }
  async entries(kind) {
    if (this.local) return readdir(kind === "regime" ? join(this.local, "regime_tributario") : this.local);
    return this.list(kind === "regime" ? PATH_REGIME : PATH_CNPJ);
  }
  /** Baixa para disco (ou usa o arquivo local) e devolve { path, size, sha256 }. */
  async fetchFile(f, tmp, stats) {
    if (this.local) {
      const buf = await readFile(f.url);
      return { path: f.url, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), local: true };
    }
    // Cache local (restaurado do cache do GitHub): um arquivo só vale se o
    // download terminou, o que é marcado pelo .sha256 ao lado dele.
    const cached = this.cache ? join(this.cache, cacheName(f.url)) : null;
    if (cached) {
      const sha = await readFile(`${cached}.sha256`, "utf8").catch(() => null);
      const st = sha ? await stat(cached).catch(() => null) : null;
      if (sha && st) {
        log(`  ${f.name}: do cache (${mb(st.size)})`);
        stats.from_cache = (stats.from_cache ?? 0) + 1;
        return { path: cached, size: st.size, sha256: sha.trim(), keep: true };
      }
      await mkdir(this.cache, { recursive: true });
    }
    // O servidor da Receita derruba conexões longas ("terminated"). Cada nova
    // tentativa continua do byte em que parou (HTTP Range), e um download parado
    // por 2 minutos é abortado e retomado.
    const path = cached ?? join(tmp, f.name);
    // O sha256 é calculado do arquivo em disco no fim: depois de uma queda, o
    // ponto de retomada é o tamanho real gravado, não o que passou pelo stream.
    let size = 0, next = 256 * 1048576, fails = 0;
    await rm(path, { force: true });
    for (;;) {
      const ctrl = new AbortController();
      let idle = setTimeout(() => ctrl.abort(new Error("download parado há 2 min")), IDLE_MS);
      try {
        const headers = { "user-agent": UA, ...(await this.auth()) };
        if (size > 0) headers.range = `bytes=${size}-`;
        const r = await fetch(f.url, { headers, signal: ctrl.signal });
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} em ${f.name}`);
        if (size > 0 && r.status !== 206) {
          // Servidor ignorou o Range e mandou o arquivo inteiro: recomeça do
          // zero com esta resposta, sem misturar bytes.
          log(`  ${f.name}: servidor não retomou do byte ${size}; recomeçando do início`);
          size = 0; next = 256 * 1048576;
          await rm(path, { force: true });
        }
        const meter = new Transform({
          transform(chunk, _e, cb) {
            clearTimeout(idle);
            idle = setTimeout(() => ctrl.abort(new Error("download parado há 2 min")), IDLE_MS);
            size += chunk.length;
            if (size >= next) { log(`  ${f.name}: ${mb(size)} baixados`); next += 256 * 1048576; }
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(r.body), meter, createWriteStream(path, { flags: "a" }));
        clearTimeout(idle);
        size = (await stat(path)).size;
        const h = createHash("sha256");
        for await (const chunk of createReadStream(path)) h.update(chunk);
        stats.bytes_downloaded += size;
        stats.peak_disk_bytes = Math.max(stats.peak_disk_bytes, size);
        const sha256 = h.digest("hex");
        if (cached) {
          await writeFile(`${cached}.sha256`, sha256);
          stats.to_cache = (stats.to_cache ?? 0) + 1;
        }
        return { path, size, sha256, keep: !!cached };
      } catch (e) {
        clearTimeout(idle);
        size = await stat(path).then((x) => x.size, () => 0);
        fails++;
        if (fails >= MAX_TRIES) throw e;
        const wait = Math.min(60_000, 5000 * fails);
        log(`  ${f.name}: falha (${e.message}) em ${mb(size)}; retomando (${fails + 1}/${MAX_TRIES}) em ${wait / 1000}s`);
        await new Promise((ok) => setTimeout(ok, wait));
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

// Lê a cadeia de certificados que o servidor Postgres apresenta (dados públicos),
// para diagnosticar falhas de verificação TLS. Não envia credenciais.
export async function describeServerChain(raw) {
  const u = new URL(raw);
  const net = await import("node:net"), tls = await import("node:tls");
  const host = u.hostname, port = Number(u.port || 5432);
  const sock = net.connect(port, host);
  await new Promise((ok, ko) => { sock.once("connect", ok); sock.once("error", ko); });
  const req = Buffer.alloc(8); req.writeInt32BE(8, 0); req.writeInt32BE(80877103, 4);
  sock.write(req);
  const resp = await new Promise((ok, ko) => { sock.once("data", ok); sock.once("error", ko); });
  if (resp[0] !== 0x53) { sock.destroy(); return "servidor não aceitou TLS"; }
  const t = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false });
  await new Promise((ok, ko) => { t.once("secureConnect", ok); t.once("error", ko); });
  const out = []; let c = t.getPeerCertificate(true); const seen = new Set();
  while (c && c.fingerprint256 && !seen.has(c.fingerprint256)) {
    seen.add(c.fingerprint256);
    out.push(`[${c.subject?.CN ?? "?"} ← emitido por ${c.issuer?.CN ?? "?"} (sha256 ${c.fingerprint256.slice(0, 11)})]`);
    c = c.issuerCertificate;
  }
  t.destroy();
  return out.join(" ");
}

// Descreve o endereço do banco sem a senha, para diagnosticar segredos mal formados.
export function describeDbUrl(raw) {
  const arrobas = (raw.match(/@/g) ?? []).length;
  let u;
  try { u = new URL(raw); } catch { return `não é uma URL válida (${arrobas} "@")`; }
  const especiais = /[@#/?:%\[\] ]/.test(decodeURIComponent(u.password || ""));
  return [`protocolo=${u.protocol.replace(":", "")}`, `host=${u.hostname || "(vazio)"}`, `porta=${u.port || "(padrão)"}`,
    `usuário=${decodeURIComponent(u.username) || "(vazio)"}`, `banco=${u.pathname.slice(1) || "(vazio)"}`,
    `senha=${u.password ? "presente" : "ausente"}`, `"@" no texto=${arrobas}`,
    ...(arrobas > 1 || raw.includes("#") ? ["provável caractere especial não codificado na senha"] : []),
    ...(especiais ? ["senha com caractere especial"] : [])].join(", ");
}

class PgDb {
  constructor(url) { this.url = url; }
  async connect() {
    let pg;
    try { pg = (await import("pg")).default; } catch {
      throw new Error("Pacote `pg` não encontrado. Rode `bun install`.");
    }
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(this.url) || /sslmode=disable/.test(this.url);
    // O pooler do Supabase usa certificado da CA própria do Supabase (não pública).
    // A raiz pública "Supabase Root 2021 CA" (Database Settings → SSL Configuration)
    // vem junto do executor (sha256 80:70:25:AD…, a mesma raiz que o pooler apresenta).
    const ca = local ? undefined : await readFile(new URL("./supabase-root-2021-ca.crt", import.meta.url), "utf8");
    this.c = new pg.Client({ connectionString: this.url, ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) } });
    try {
      await this.c.connect();
    } catch (e) {
      let dica = "";
      if (/CERT|SELF_SIGNED/.test(e.code ?? "")) {
        const fonte = "arquivo supabase-root-2021-ca.crt";
        let nossa = "?";
        try { const x = new (await import("node:crypto")).X509Certificate(ca); nossa = `${x.subject.replace(/\n/g, ", ")} (sha256 ${x.fingerprint256.slice(0, 11)})`; } catch { nossa = "certificado ilegível"; }
        dica = `; certificado usado (${fonte}): ${nossa}; cadeia do servidor: ${await describeServerChain(this.url).catch((x) => `não lida (${x.message})`)}`;
      }
      throw new Error(`conexão ao banco falhou (${e.code ?? e.message})${dica}; endereço lido: ${describeDbUrl(this.url)}`);
    }
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
    if (!dl.local && !dl.keep) await rm(dl.path, { force: true });
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
  const { roots, db, origin, tmp, stats, report } = ctx;
  const ds = "receita_regime_tributario";
  const files = await origin.files("regime", ctx.competencia);
  report.datasets[ds] = { files: [], matched: 0, not_found: 0, inserted: 0, cached: 0 };
  if (!files.length) {
    const entries = await origin.entries("regime").catch((e) => [`(listagem falhou: ${e.message})`]);
    throw new LayoutError(`regime tributário: nenhum .zip na pasta publicada; itens: ${entries.slice(0, 30).join(", ")}`);
  }
  // A ECF é declarada pela matriz: casa pela raiz (8 dígitos), para que a filial
  // cuja matriz não está na base também receba o regime. Cada linha leva o CNPJ
  // declarante; o banco confere que ele é da mesma raiz.
  const acc = new Map(); // raiz -> linhas
  for (const f of files) {
    const t0 = Date.now();
    const dl = await origin.fetchFile(f, tmp, stats);
    await db.file(f.name, dl.size, dl.sha256, null, 0, 0, 0, "processando");
    let n = 0, matched = 0, idx = null, header = null, sep = ";";
    for (const member of await listZip(dl.path)) {
      let first = true;
      for await (const batch of lineBatches(openMember(dl.path, member))) {
        for (const line of batch) {
          if (first) {
            first = false;
            // Arquivos de nov/2026 vêm separados por vírgula; aceita ";" também.
            sep = line.includes(";") ? ";" : ",";
            header = parseLine(line, sep);
            const h = regimeHeader(header);
            if (h.erro) throw new LayoutError(`${f.name}: cabeçalho inesperado (${h.erro}): ${header.join(" | ").slice(0, 300)}`);
            idx = h.idx;
            continue;
          }
          n++;
          const fields = parseLine(line, sep);
          const cnpj = cnpjStrip(fields[idx.cnpj]).padStart(14, "0");
          const raiz = cnpj.slice(0, 8);
          if (!roots.has(raiz)) continue;
          const ano = (fields[idx.ano] ?? "").trim();
          const forma = (fields[idx.forma] ?? "").trim();
          if (!/^\d{4}$/.test(ano) || !forma) { stats.rejected++; continue; }
          matched++;
          const l = acc.get(raiz) ?? [];
          l.push({ cnpj, ano, forma, cnpj_da_scp: idx.cnpj_da_scp !== undefined ? (fields[idx.cnpj_da_scp] ?? "").trim() : "",
            quantidade: idx.quantidade !== undefined ? (fields[idx.quantidade] ?? "").trim() : "", arquivo: f.name });
          acc.set(raiz, l);
        }
      }
    }
    await db.file(f.name, null, null, header, n, matched, n, "concluido");
    stats.rows_scanned += n;
    stats.rows_matched += matched;
    report.datasets[ds].files.push({ name: f.name, size: dl.size, sha256: dl.sha256, rows: n, matched, header,
      seconds: Math.round((Date.now() - t0) / 1000) });
    log(`${ds} · ${f.name}: ${mb(dl.size)}, ${n.toLocaleString("pt-BR")} linhas, ${matched} da carteira`);
    if (!dl.local && !dl.keep) await rm(dl.path, { force: true });
  }
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const r = await db.batch(ds, pending);
    report.datasets[ds].inserted += r.inserted;
    report.datasets[ds].cached += r.cached;
    pending = [];
  };
  for (const raiz of roots) {
    const linhas = acc.get(raiz);
    if (linhas) {
      pending.push({ key: raiz, status: "ok", raw: { linhas }, n: { linhas: linhas.map(({ arquivo, ...r }) => r) } });
      if (ctx.publicSample && [...ctx.publicSample].some((c) => c.startsWith(raiz)))
        report.sample[ds] = { ...(report.sample[ds] ?? {}), [raiz]: linhas };
    } else {
      pending.push({ key: raiz, status: "nao_encontrado" });
      report.datasets[ds].not_found++;
    }
    if (pending.length >= BATCH) await flush();
  }
  await flush();
  report.datasets[ds].matched = acc.size;
}

// Tabelas de código → descrição publicadas junto com o CNPJ (Municipios, Cnaes, Naturezas).
async function loadTable(ctx, re) {
  const f = (await ctx.origin.files("cnpj", ctx.competencia)).find((x) => re.test(x.name));
  const map = new Map();
  if (!f) return map;
  const dl = await ctx.origin.fetchFile(f, ctx.tmp, ctx.stats);
  for (const member of await listZip(dl.path))
    for await (const batch of lineBatches(openMember(dl.path, member)))
      for (const line of batch) { const [c, d] = parseLine(line); if (c) map.set(c.trim(), (d ?? "").trim()); }
  if (!dl.local && !dl.keep) await rm(dl.path, { force: true });
  return map;
}

// ---------------------------------------------------------------- principal
export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  const t0 = Date.now();
  const origin = new Origin(a);
  if (a.publicacao) {
    // Só confere o que está publicado; não baixa arquivo nem toca no banco.
    const p = await origin.publicacao();
    await writeFile(a.publicacao, JSON.stringify(p, null, 2));
    log(`publicação: competência ${p.competencia}, ${p.arquivos_cnpj} arquivos do CNPJ, regime ${p.arquivos_regime.join(", ")}, impressão ${p.impressao}`);
    return p;
  }
  const stats = { bytes_downloaded: 0, peak_disk_bytes: 0, rows_scanned: 0, rows_matched: 0, rejected: 0 };
  const report = { competencia: null, modo: a.sonda ? "sonda" : process.env.TAX_INGESTOR_DATABASE_URL ? "banco" : "sem-banco",
    datasets: {}, sample: {}, stats };
  const base = a.tmp ?? tmpdir();
  await mkdir(base, { recursive: true });
  const tmp = await mkdtemp(join(base, "tax-intel-"));

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
    if (a.datasets.includes("receita_estabelecimentos")) {
      ctx.municipios = await loadTable(ctx, /^municipios\.zip$/i);
      ctx.cnaes = await loadTable(ctx, /^cnaes\.zip$/i);
    }
    if (a.datasets.includes("receita_empresas")) ctx.naturezas = await loadTable(ctx, /^naturezas\.zip$/i);
    // Registra de antemão todos os arquivos da execução ("pendente"), para o
    // app mostrar o andamento real (arquivos lidos / total) desde o início.
    for (const ds of a.datasets) {
      const plan = ds === "receita_regime_tributario"
        ? await origin.files("regime", competencia)
        : (await origin.files("cnpj", competencia)).filter((f) => DATASETS[ds].files.test(f.name));
      for (const f of plan) await db.file(f.name, null, null, null, 0, 0, 0, "pendente");
    }
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
