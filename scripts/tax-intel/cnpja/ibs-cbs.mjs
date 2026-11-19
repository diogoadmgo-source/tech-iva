// Carga da opção pelo regime regular de IBS/CBS dos optantes do Simples pela
// CNPJá (API paga, autorizada pelo usuário em 19/11/2026; migration 0255).
//
// Lê os alvos e grava com o papel tax_ingestor. Respeita um teto de créditos e
// para no primeiro 401/402/403/429. O repositório é público: o log NUNCA mostra
// CNPJ ou nome, só totais. Limite da conta: 40 créditos por minuto; com 3 créditos por consulta, 5 s entre elas.
//
// Parâmetros (scripts/tax-intel/cnpja/execucao.json; o disparo manual sobrepõe):
//   max_creditos  teto de créditos desta execução
//   historico     true = pede simplesHistory (no teste de 19/11 os eventos
//                 IBS/CBS vieram com ele; custa 1 crédito a mais)
//   valido_desde  AAAA-MM-DD, fim da última janela de opção da Receita: só
//                 reconsulta quem foi consultado antes dessa data
//   idade_dias    (sem valido_desde) reconsulta quem foi consultado há mais que isso
//   amostra       >0 = só sonda N empresas e NÃO grava (mostra a estrutura)
import { readFile } from "node:fs/promises";

/** Lê company.simples.events: [{regime: IBS|CBS, from, text}]. null = não reconhecido. */
export function opcao(simples, regime) {
  // Sem o campo events não há resposta (sem simplesHistory ele não vem): nunca vira "não".
  if (!Array.isArray(simples?.events)) return null;
  const ev = simples.events.filter(
    (e) => String(e?.regime ?? "").toUpperCase() === regime,
  );
  if (!ev.length) return { valor: "nao", desde: null };
  const e = ev.find((x) => /op[çc][ãa]o pelo regime regular/i.test(String(x?.text ?? "")));
  if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.from ?? ""))) return null;
  return { valor: "sim", desde: e.from };
}

async function main() {
  const cfg = JSON.parse(await readFile(new URL("./execucao.json", import.meta.url), "utf8"));
  const env = (k) => (process.env[k] ? process.env[k] : undefined);
  const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
  const MAX = num(env("MAX_CREDITOS") ?? cfg.max_creditos, 0);
  const HIST = String(env("HISTORICO") ?? cfg.historico ?? "true") === "true";
  // Validade por janela de opção: quem foi consultado depois do fim da última
  // janela da Receita não é consultado de novo (o dado é compartilhado entre
  // todos os clientes). Sem valido_desde, vale idade_dias.
  const desde = env("VALIDO_DESDE") ?? cfg.valido_desde;
  const IDADE = /^\d{4}-\d{2}-\d{2}$/.test(String(desde ?? ""))
    ? Math.max(0, Math.floor((Date.now() - Date.parse(`${desde}T03:00:00Z`)) / 86_400_000))
    : num(env("IDADE_DIAS") ?? cfg.idade_dias, 30);
  const AMOSTRA = num(env("AMOSTRA") ?? cfg.amostra, 0);
  const CUSTO = HIST ? 3 : 2;
  const KEY = process.env.CNPJA_API_KEY;
  const DB = process.env.TAX_INGESTOR_DATABASE_URL;
  if (!KEY || !DB) throw new Error("faltam CNPJA_API_KEY ou TAX_INGESTOR_DATABASE_URL");
  if (MAX < CUSTO) throw new Error(`max_creditos (${MAX}) menor que o custo de uma consulta (${CUSTO})`);

  const pg = (await import("pg")).default;
  const ca = await readFile(new URL("../executor/supabase-root-2021-ca.crt", import.meta.url), "utf8");
  const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: true, ca } });
  await db.connect();

  const alvos = [];
  for (let after = null; ; ) {
    const { rows } = await db.query(
      "select cnpj, cnpj_raiz from tax_ingest_ibs_cbs_targets($1, 5000, $2)",
      [after, IDADE],
    );
    alvos.push(...rows);
    if (rows.length < 5000) break;
    after = rows.at(-1).cnpj_raiz;
  }
  const limite = Math.floor(MAX / CUSTO);
  const fila = AMOSTRA > 0 ? alvos.slice(0, Math.min(AMOSTRA, limite)) : alvos.slice(0, limite);
  console.log(
    `alvos pendentes: ${alvos.length} · custo por empresa: ${CUSTO} créditos · teto: ${MAX} · nesta execução: ${fila.length}${AMOSTRA ? " (amostra, sem gravar)" : ""}`,
  );

  const forma = (v) =>
    Array.isArray(v) ? (v.length ? [forma(v[0])] : [])
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, forma(x)]))
    : v === null ? null : typeof v;

  const tot = { ok: 0, sim: 0, nao: 0, erro: 0, nao_reconhecido: 0, fora_do_simples: 0, creditos: 0 };
  let lote = [];
  const gravar = async () => {
    const l = lote;
    lote = [];
    if (!l.length || AMOSTRA) return;
    await db.query("select tax_ingest_ibs_cbs($1::jsonb)", [JSON.stringify(l)]);
  };

  let parar = null;
  try {
    for (const [i, a] of fila.entries()) {
      const url = `https://api.cnpja.com/office/${a.cnpj}?simples=true${HIST ? "&simplesHistory=true" : ""}`;
      let r, txt;
      for (let t = 0; t < 6; t++) {
        r = await fetch(url, { headers: { Authorization: KEY } });
        txt = await r.text();
        if (r.status === 429) {
          // Limite por minuto da conta: espera o tempo pedido e tenta de novo.
          const espera = Math.min(Number(r.headers.get("retry-after")) || 60, 300);
          console.log(`limite por minuto (429): esperando ${espera}s`);
          await new Promise((ok) => setTimeout(ok, espera * 1000));
          continue;
        }
        if (r.status < 500) break;
        await new Promise((ok) => setTimeout(ok, 5000 * (t + 1)));
      }
      if ([401, 402, 403, 429].includes(r.status)) {
        parar = `HTTP ${r.status} (chave, créditos ou limite)`;
        break;
      }
      if (!r.ok) {
        tot.erro++;
        lote.push({
          raiz: a.cnpj_raiz,
          status: r.status === 404 ? "nao_encontrado" : "erro",
          http: r.status,
          erro: txt.slice(0, 300).replace(/\d{8,}/g, "…"),
        });
      } else {
        tot.creditos += CUSTO;
        const s = JSON.parse(txt)?.company?.simples ?? null;
        if (AMOSTRA) {
          if (i === 0) console.log("estrutura de company.simples:", JSON.stringify(forma(s)));
          console.log(`#${i + 1}: eventos IBS/CBS: ${Array.isArray(s?.events) ? s.events.length : "campo ausente"}`);
        }
        const ibs = opcao(s, "IBS");
        const cbs = opcao(s, "CBS");
        if (s?.optant !== true) {
          tot.fora_do_simples++;
          lote.push({ raiz: a.cnpj_raiz, status: "erro", http: r.status, erro: "CNPJá não aponta como optante do Simples", raw: s });
        } else if (!ibs || !cbs) {
          tot.nao_reconhecido++;
          lote.push({ raiz: a.cnpj_raiz, status: "erro", http: r.status, erro: "evento IBS/CBS não reconhecido", raw: s });
        } else {
          tot.ok++;
          tot[ibs.valor === "sim" || cbs.valor === "sim" ? "sim" : "nao"]++;
          lote.push({
            raiz: a.cnpj_raiz, status: "ok", http: r.status,
            ibs: ibs.valor, ibs_desde: ibs.desde, cbs: cbs.valor, cbs_desde: cbs.desde, raw: s,
          });
        }
      }
      if (lote.length >= 50) await gravar();
      if ((i + 1) % 50 === 0) console.log(`andamento: ${i + 1}/${fila.length}`);
      await new Promise((ok) => setTimeout(ok, CUSTO === 3 ? 5000 : 3500));
    }
  } finally {
    await gravar();
    await db.end();
  }
  console.log("totais:", JSON.stringify(tot));
  if (parar) {
    console.log(`parou: ${parar}`);
    if (!tot.ok) process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
