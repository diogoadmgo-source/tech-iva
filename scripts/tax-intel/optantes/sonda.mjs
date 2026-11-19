// Sonda da Consulta Optantes (Receita / Simples Nacional).
// UMA consulta, com CNPJ público de órgão (Banco do Brasil, 00.000.000/0001-91),
// nunca CNPJ da carteira (o repositório é público). Descobre como a página
// funciona: que chamada de rede ela faz, se há captcha e o que volta.
// Não contorna captcha: se aparecer, só registra.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const URL = "https://consopt.www8.receita.fazenda.gov.br/consultaoptantes";
const CNPJ = "00000000000191";
const out = process.argv[2] ?? "sonda-optantes";
mkdirSync(out, { recursive: true });

const log = [];
const browser = await chromium.launch();
const page = await browser.newPage({ locale: "pt-BR" });
page.on("request", (r) => {
  if (["document", "xhr", "fetch", "script"].includes(r.resourceType()))
    log.push({ t: "req", tipo: r.resourceType(), metodo: r.method(), url: r.url(), corpo: r.postData()?.slice(0, 2000) ?? null });
});
page.on("response", async (r) => {
  const tipo = r.request().resourceType();
  if (!["document", "xhr", "fetch"].includes(tipo)) return;
  let corpo = null;
  try { corpo = (await r.text()).slice(0, 4000); } catch {}
  log.push({ t: "resp", tipo, status: r.status(), url: r.url(), headers: r.headers(), corpo });
});

const r0 = await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
console.log("abertura:", r0?.status());
const html0 = await page.content();
writeFileSync(`${out}/pagina.html`, html0);
await page.screenshot({ path: `${out}/1-abertura.png`, fullPage: true });
const captcha = /hcaptcha|recaptcha|turnstile|data-sitekey|captcha/i.exec(html0);
console.log("captcha na página:", captcha ? captcha[0] : "não encontrado");

const input = page.locator("input:visible").first();
await input.fill(CNPJ);
await page.getByRole("button", { name: /consultar/i }).first().click();
await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/2-resultado.png`, fullPage: true });
const html1 = await page.content();
writeFileSync(`${out}/resultado.html`, html1);
const captcha1 = /hcaptcha|recaptcha|turnstile|data-sitekey|captcha/i.exec(html1);
console.log("captcha após consultar:", captcha1 ? captcha1[0] : "não encontrado");
console.log("texto do resultado:\n" + (await page.locator("body").innerText()).slice(0, 3000));
writeFileSync(`${out}/rede.json`, JSON.stringify(log, null, 2));
console.log("chamadas de rede:");
for (const l of log) if (l.t === "req" && l.tipo !== "script") console.log(" ", l.metodo, l.url, l.corpo ? `corpo=${l.corpo.slice(0, 300)}` : "");
for (const l of log) if (l.t === "resp") console.log(" ", l.status, l.url, (l.corpo ?? "").slice(0, 600).replace(/\s+/g, " "));
await browser.close();
