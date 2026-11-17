#!/usr/bin/env node
// SÓ PARA TESTE LOCAL. Gera arquivos no FORMATO dos Dados Abertos do CNPJ e do
// regime tributário (ECF), com dados SINTÉTICOS, para medir o motor em escala
// sem internet. Nada daqui é dado real e nada daqui vai para o Supabase.
//
//   node gen-sintetico.mjs --alvos alvos.txt --ruido 3000000 --saida DIR
//
// alvos.txt: CNPJs (14 posições) que devem "casar". O ruído são linhas de
// outros CNPJs, para a varredura ter volume parecido com o real.
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { once } from "node:events";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => {
  if (v.startsWith("--")) acc.push([v.slice(2), arr[i + 1]]);
  return acc;
}, []));
const out = args.saida;
const COMP = args.competencia ?? "2026-10";
const noise = Number(args.ruido ?? 1000000);
const alvos = (await readFile(args.alvos, "utf8")).split(/\r?\n/).filter(Boolean);

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

function dv(base12) {
  const W = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const v = (c) => c.charCodeAt(0) - 48;
  let s = 0;
  for (let i = 0; i < 12; i++) s += v(base12[i]) * W[i + 1];
  let r = s % 11; const d1 = r < 2 ? 0 : 11 - r;
  s = d1 * W[12];
  for (let i = 0; i < 12; i++) s += v(base12[i]) * W[i];
  r = s % 11; const d2 = r < 2 ? 0 : 11 - r;
  return `${base12}${d1}${d2}`;
}

async function writeLines(path, gen) {
  const ws = createWriteStream(path, { encoding: "latin1" });
  for (const line of gen()) {
    if (!ws.write(line + "\r\n")) await once(ws, "drain");
  }
  ws.end();
  await once(ws, "finish");
}
function zipIt(dir, csv, zipName) {
  execFileSync("zip", ["-q", "-j", join(dir, zipName), join(dir, csv)]);
  return rm(join(dir, csv));
}

const dir = join(out, COMP);
const dirR = join(out, "regime_tributario");
await mkdir(dir, { recursive: true });
await mkdir(dirR, { recursive: true });

const roots = [...new Set(alvos.map((c) => c.slice(0, 8)))];
// Ruído na faixa 70000000–79999999 (os alvos sintéticos locais estão em outras faixas).
const noiseRoot = (i) => String(70000000 + (i % 9999999)).padStart(8, "0").slice(0, 8);
const noiseCnpj = (i) => dv(`${noiseRoot(i)}${String(1 + (i % 9)).padStart(4, "0")}`);

// Perfil sintético de cada raiz-alvo (determinístico).
const perfil = new Map();
for (const r of roots) {
  const x = rnd();
  perfil.set(r, x < 0.35 ? "simples" : x < 0.45 ? "mei" : x < 0.55 ? "excluido" : x < 0.6 ? "excluido_ecf_antiga" : "nunca");
}

await writeLines(join(dir, "Municipios.csv"), function* () {
  yield `${q("7107")};${q("SAO PAULO")}`;
  yield `${q("6001")};${q("RIO DE JANEIRO")}`;
});
await zipIt(dir, "Municipios.csv", "Municipios.zip");

await writeLines(join(dir, "Simples.csv"), function* () {
  let i = 0;
  for (const r of roots) {
    const p = perfil.get(r);
    if (p === "simples") yield [r, "S", "20180101", "00000000", "N", "00000000", "00000000"].map(q).join(";");
    else if (p === "mei") yield [r, "S", "20200301", "00000000", "S", "20200301", "00000000"].map(q).join(";");
    else if (p === "excluido") yield [r, "N", "20150101", "20231231", "N", "00000000", "00000000"].map(q).join(";");
    else if (p === "excluido_ecf_antiga") yield [r, "N", "20190101", "20250131", "N", "00000000", "00000000"].map(q).join(";");
    if (++i % 7 === 0) yield [noiseRoot(i), "S", "20210101", "00000000", "N", "00000000", "00000000"].map(q).join(";");
  }
  for (let k = 0; k < noise / 4; k++) yield [noiseRoot(k + 7), "N", "20100101", "20121231", "N", "00000000", "00000000"].map(q).join(";");
});
await zipIt(dir, "Simples.csv", "Simples.zip");

await writeLines(join(dir, "Empresas0.csv"), function* () {
  for (const r of roots) yield [r, `EMPRESA SINTETICA ${r} LTDA`, "2062", "49", "10000,00", "03", ""].map(q).join(";");
  for (let k = 0; k < noise / 2; k++) yield [noiseRoot(k), `RUIDO ${k} LTDA`, "2062", "49", "1000,00", "01", ""].map(q).join(";");
});
await zipIt(dir, "Empresas0.csv", "Empresas0.zip");

await writeLines(join(dir, "Estabelecimentos0.csv"), function* () {
  const tail = (uf, mun) => [...Array(6).fill(""), uf, mun, ...Array(9).fill("")]; // colunas 13–29
  for (const c of alvos) {
    yield [c.slice(0, 8), c.slice(8, 12), c.slice(12), c.slice(8, 12) === "0001" ? "1" : "2", "FANTASIA SINTETICA",
      "02", "20190101", "00", "", "", "20100101", "4711302", "", ...tail("SP", "7107")].map(q).join(";");
  }
  for (let k = 0; k < noise; k++) {
    const c = noiseCnpj(k);
    yield [c.slice(0, 8), c.slice(8, 12), c.slice(12), "1", "", "08", "20200101", "01", "", "", "20000101", "4711302", "",
      ...tail("RJ", "6001")].map(q).join(";");
  }
});
await zipIt(dir, "Estabelecimentos0.csv", "Estabelecimentos0.zip");

// Regime tributário (ECF): cabeçalho ASSUMIDO para o teste local
// (ano;cnpj;cnpj_da_scp;forma_de_tributacao;quantidade_de_escrituracoes).
const header = ["ano", "cnpj", "cnpj_da_scp", "forma_de_tributacao", "quantidade_de_escrituracoes"].join(";");
const ecf = { real: [], presumido: [] };
alvos.forEach((c, i) => {
  const p = perfil.get(c.slice(0, 8));
  if (p === "nunca" && c.slice(8, 12) === "0001") {
    if (i % 3 === 0) ecf.real.push([2024, c]);
    else if (i % 3 === 1) ecf.presumido.push([2024, c], [2023, c]);
  }
  if (p === "excluido_ecf_antiga" && c.slice(8, 12) === "0001") ecf.presumido.push([2018, c]);
});
for (const [name, rows, forma] of [["Lucro Real.csv", ecf.real, "LUCRO REAL"], ["Lucro Presumido.csv", ecf.presumido, "LUCRO PRESUMIDO"]]) {
  await writeLines(join(dirR, name), function* () {
    yield header;
    for (const [ano, c] of rows) yield [ano, c, "", forma, "1"].join(";");
    for (let k = 0; k < noise / 10; k++) yield [2024, noiseCnpj(k), "", forma, "1"].join(";");
  });
  await zipIt(dirR, name, name.replace(".csv", ".zip"));
}
console.log(JSON.stringify({ competencia: COMP, alvos: alvos.length, raizes: roots.length, ruido: noise,
  perfis: [...perfil.values()].reduce((a, p) => ({ ...a, [p]: (a[p] ?? 0) + 1 }), {}),
  ecf: { real: ecf.real.length, presumido: ecf.presumido.length } }));
