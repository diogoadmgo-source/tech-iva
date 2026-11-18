// Executor do motor em massa (scripts/tax-intel/executor): leitura em fluxo,
// layout, validação e a regra de não vazar CNPJ da carteira no log.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
// @ts-expect-error módulo .mjs sem tipos
import { parseLine, firstField, lineBatches } from "../../../scripts/tax-intel/executor/csv.mjs";
// @ts-expect-error módulo .mjs sem tipos
import { listZip, openMember } from "../../../scripts/tax-intel/executor/zip.mjs";
// @ts-expect-error módulo .mjs sem tipos
import { receitaDate, regimeHeader, DATASETS } from "../../../scripts/tax-intel/executor/layouts.mjs";
// @ts-expect-error módulo .mjs sem tipos
import { cnpjValid } from "../../../scripts/tax-intel/executor/cnpj.mjs";
// @ts-expect-error módulo .mjs sem tipos
import { parsePropfind, parsePropfindEtags, REGIME_FILE, main, AMOSTRA_PUBLICA } from "../../../scripts/tax-intel/executor/run.mjs";
import { isValidCnpj, cnpjCheckDigits } from "./cnpj";

const hasZip = (() => {
  try {
    execFileSync("zip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("CSV da Receita", () => {
  it("separa campos com aspas, ';' dentro de aspas e aspas duplicadas", () => {
    expect(parseLine('"1";"A;B";"diz ""oi""";;"x"')).toEqual(["1", "A;B", 'diz "oi"', "", "x"]);
    expect(parseLine("a;b;")).toEqual(["a", "b", ""]);
    expect(firstField('"12345678";"S"')).toBe("12345678");
    expect(firstField("12345678;S")).toBe("12345678");
  });

  it("lê ISO-8859-1 em lotes, com CRLF ou LF, sem perder linha entre pedaços", async () => {
    const text = Buffer.from('"1";"JOSÉ"\r\n"2";"AÇÃO"\n"3";"FIM"', "latin1");
    const chunks = [text.subarray(0, 7), text.subarray(7, 15), text.subarray(15)];
    const out: string[] = [];
    for await (const b of lineBatches(Readable.from(chunks))) out.push(...b);
    expect(out).toEqual(['"1";"JOSÉ"', '"2";"AÇÃO"', '"3";"FIM"']);
  });
});

describe("layout", () => {
  it("datas AAAAMMDD; zeros = vazio; data impossível = erro", () => {
    expect(receitaDate("20240131")).toBe("2024-01-31");
    expect(receitaDate("00000000")).toBeNull();
    expect(receitaDate("")).toBeNull();
    expect(receitaDate("20240231")).toBeUndefined();
    expect(receitaDate("2024-01-31")).toBeUndefined();
  });

  it("Simples: S/N e datas; valor fora do domínio recusa a linha", () => {
    const L = DATASETS.receita_simples;
    expect(
      L.normalize(["12345678", "S", "20180101", "00000000", "N", "00000000", "00000000"]),
    ).toEqual({
      opcao_simples: "S",
      data_opcao_simples: "2018-01-01",
      data_exclusao_simples: null,
      opcao_mei: "N",
      data_opcao_mei: null,
      data_exclusao_mei: null,
    });
    expect(L.normalize(["12345678", "X", "20180101", "", "N", "", ""])).toBeNull();
  });

  it("regime tributário: colunas pelo cabeçalho, com ou sem acento; falta coluna = erro", () => {
    expect(
      regimeHeader([
        "Ano",
        "CNPJ",
        "CNPJ da SCP",
        "Forma de Tributação",
        "Quantidade de escriturações",
      ]).idx,
    ).toEqual({ ano: 0, cnpj: 1, cnpj_da_scp: 2, forma: 3, quantidade: 4 });
    expect(regimeHeader(["ano", "cnpj"]).erro).toMatch(/forma/);
  });

  it("listagem WebDAV (formato real do Nextcloud da Receita, nov/2026)", () => {
    const xml =
      '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
      "<d:response><d:href>/public.php/webdav/Dados/Cadastros/CNPJ/</d:href></d:response>" +
      "<d:response><d:href>/public.php/webdav/Dados/Cadastros/CNPJ/2024-03/</d:href></d:response>" +
      "<d:response><d:href>/public.php/webdav/Dados/Cadastros/CNPJ/2026-11/</d:href></d:response>" +
      "<d:response><d:href>/public.php/webdav/Dados/Cadastros/CNPJ/Leia%20me.pdf</d:href></d:response>" +
      "</d:multistatus>";
    expect(parsePropfind(xml, "/public.php/webdav/Dados/Cadastros/CNPJ/")).toEqual(["2024-03/", "2026-11/", "Leia me.pdf"]);
  });

  it("ETag de cada arquivo (base da verificação diária)", () => {
    const xml =
      '<d:multistatus xmlns:d="DAV:">' +
      "<d:response><d:href>/public.php/webdav/Dados/X/</d:href><d:propstat><d:prop><d:getetag>&quot;dir1&quot;</d:getetag></d:prop></d:propstat></d:response>" +
      "<d:response><d:href>/public.php/webdav/Dados/X/Simples.zip</d:href><d:propstat><d:prop><d:getetag>&quot;abc123&quot;</d:getetag></d:prop></d:propstat></d:response>" +
      "</d:multistatus>";
    expect(parsePropfindEtags(xml, "/public.php/webdav/Dados/X/")).toEqual({ "Simples.zip": "abc123" });
  });

  it("regime: só os arquivos de forma de tributação da ECF", () => {
    const nomes = ["entidades-lucro-real.zip", "entidades-lucro-presumido.zip", "entidades-lucro-arbitrado.zip",
      "entidades-imunes-e-isentas.zip", "renuncia-irpj-csll-ecf.csv"];
    expect(nomes.filter((n) => REGIME_FILE.test(n))).toEqual(nomes.slice(0, 3));
  });
});

describe("CNPJ do executor = CNPJ do app", () => {
  it("mesma resposta em numéricos e alfanuméricos", () => {
    const bodies = ["000000000001", "123456780001", "12ABC34501DE", "AAAAAAAA0001", "999999990002"];
    for (const b of bodies) {
      const ok = b + cnpjCheckDigits(b);
      expect(cnpjValid(ok)).toBe(isValidCnpj(ok));
      expect(cnpjValid(ok)).toBe(true);
      const bad = ok.slice(0, 13) + String((Number(ok[13]) + 1) % 10);
      expect(cnpjValid(bad)).toBe(isValidCnpj(bad));
    }
    expect(cnpjValid("12ABC34501DE35")).toBe(true);
    for (const c of AMOSTRA_PUBLICA) expect(cnpjValid(c)).toBe(true);
  });
});

describe.skipIf(!hasZip)("ZIP e varredura ponta a ponta (arquivos sintéticos)", () => {
  const dir = mkdtempSync(join(tmpdir(), "exec-test-"));
  const comp = join(dir, "2026-10");
  const reg = join(dir, "regime_tributario");
  mkdirSync(comp);
  mkdirSync(reg);
  const alvo = "12345678000195";
  const q = (v: string) => `"${v}"`;
  const est = (c: string) =>
    [
      c.slice(0, 8),
      c.slice(8, 12),
      c.slice(12),
      "1",
      "FANT",
      "02",
      "20200101",
      "00",
      "",
      "",
      "20100101",
      "4711302",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "SP",
      "7107",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]
      .map(q)
      .join(";");
  const zipOf = (folder: string, csv: string, body: string, zipName: string) => {
    writeFileSync(join(folder, csv), Buffer.from(body, "latin1"));
    execFileSync("zip", ["-q", "-j", "-m", join(folder, zipName), join(folder, csv)]);
  };
  zipOf(
    comp,
    "Simples.csv",
    [
      '"12345678";"S";"20180101";"00000000";"N";"00000000";"00000000"',
      '"87654321";"N";"20100101";"20121231";"N";"00000000";"00000000"',
    ].join("\n"),
    "Simples.zip",
  );
  zipOf(
    comp,
    "Estabelecimentos0.csv",
    [est(alvo), est("87654321000150")].join("\r\n"),
    "Estabelecimentos0.zip",
  );
  zipOf(comp, "Municipios.csv", '"7107";"SÃO PAULO"', "Municipios.zip");
  // Formato real publicado (ECF, nov/2026): vírgula, um zip por forma de tributação.
  zipOf(
    reg,
    "Lucro Real.csv",
    `ano,cnpj,cnpj_da_scp,forma_de_tributacao,quantidade_de_escrituracoes\n2024,${alvo},,LUCRO REAL,1`,
    "entidades-lucro-real.zip",
  );
  const alvos = join(dir, "alvos.txt");
  writeFileSync(alvos, `${alvo}\n`);

  it("lê o diretório central e descompacta o membro", async () => {
    const [m] = await listZip(join(comp, "Simples.zip"));
    expect(m.name).toBe("Simples.csv");
    const lines: string[] = [];
    for await (const b of lineBatches(openMember(join(comp, "Simples.zip"), m))) lines.push(...b);
    expect(lines).toHaveLength(2);
  });

  it("cruza a carteira e NÃO imprime CNPJ da carteira no log", async () => {
    const printed: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      printed.push(a.map(String).join(" "));
    };
    let report;
    try {
      report = await main([
        "--fonte-local",
        dir,
        "--alvos",
        alvos,
        "--datasets",
        "receita_simples,receita_estabelecimentos,receita_regime_tributario",
      ]);
    } finally {
      console.log = orig;
    }
    expect(report.status).toBe("concluida");
    expect(report.datasets.receita_simples.matched).toBe(1);
    expect(report.datasets.receita_estabelecimentos.matched).toBe(1);
    expect(report.datasets.receita_regime_tributario.matched).toBe(1);
    const log = printed.join("\n");
    expect(log).not.toContain(alvo);
    expect(log).not.toContain(alvo.slice(0, 8));
  });

  it("arquivo fora do layout para a execução como abortada_layout", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "exec-bad-"));
    mkdirSync(join(d2, "2026-10"));
    zipOf(join(d2, "2026-10"), "Simples.csv", '"12345678";"S"\n"12345679";"S"', "Simples.zip");
    const orig = console.log;
    console.log = () => {};
    try {
      const r = await main([
        "--fonte-local",
        d2,
        "--alvos",
        alvos,
        "--datasets",
        "receita_simples",
      ]);
      expect(r.status).toBe("abortada_layout");
    } finally {
      console.log = orig;
      process.exitCode = 0;
    }
  });
});
