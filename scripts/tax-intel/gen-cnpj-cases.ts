/**
 * Gera 20 mil casos de CNPJ (válidos e inválidos, numéricos e alfanuméricos)
 * com a implementação TypeScript, para a suíte SQL comparar com
 * public.tax_cnpj_is_valid. Saída: CSV "cnpj,valid" no stdout.
 *
 * Uso: node --experimental-strip-types scripts/tax-intel/gen-cnpj-cases.ts > casos.csv
 * Semente fixa: os casos são os mesmos em toda execução.
 */
import { cnpjCheckDigits, isValidCnpj } from "../../src/lib/tax-intel/cnpj.ts";

// mulberry32: PRNG pequeno e bem distribuído (um LCG simples repetia os bits baixos).
let seed = 20261117;
function rnd(n: number): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * n | 0;
}
const NUM = "0123456789";
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function body(alpha: boolean): string {
  const set = alpha ? ALNUM : NUM;
  let s = "";
  for (let i = 0; i < 12; i += 1) s += set[rnd(set.length)];
  return s;
}

const out: string[] = ["cnpj,valid"];
const fixed = ["12ABC34501DE35", "12ABC34501DE36", "00000000000191", "11222333000181", "11222333000182",
  "00000000000000", "AAAAAAAAAAAAAA", "12ABC34501DEA5", "12abc34501de35", "1122233300018"];
for (const c of fixed) out.push(`${c},${isValidCnpj(c)}`);

for (let i = 0; i < 20000; i += 1) {
  const b = body(i % 2 === 0);
  let c = b + cnpjCheckDigits(b);
  const mode = rnd(4);
  if (mode === 1) c = c.slice(0, 13) + String((Number(c[13]) + 1 + rnd(9)) % 10); // DV2 trocado
  if (mode === 2) {
    const p = rnd(12);
    const set = ALNUM.replace(c[p]!, "");
    c = c.slice(0, p) + set[rnd(set.length)] + c.slice(p + 1); // corpo alterado
  }
  out.push(`${c},${isValidCnpj(c)}`);
}
process.stdout.write(out.join("\n") + "\n");
