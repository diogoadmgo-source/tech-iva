/**
 * Guarda: o módulo de Inteligência Tributária NÃO reutiliza a regra existente
 * que classifica todo não optante do Simples como Lucro Presumido
 * (regime_from_registry / regime_hint "presumido" em src/lib/cnpj*.ts), nem as
 * tabelas do cadastro antigo. A regra existente continua intacta e fora daqui.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "..");
const moduleFiles = [
  ...readdirSync(join(root, "src/lib/tax-intel"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join("src/lib/tax-intel", f)),
  ...readdirSync(join(root, "src/routes/_authenticated"))
    .filter((f) => f.includes("tributario"))
    .map((f) => join("src/routes/_authenticated", f)),
];
const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((f) => /_024\d_inteligencia_tributaria_/.test(f))
  .map((f) => join("supabase/migrations", f));

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");

describe("separação da regra de regime existente", () => {
  it("o código do módulo não importa o cadastro de CNPJ antigo nem a dica de regime", () => {
    expect(moduleFiles.length).toBeGreaterThan(0);
    for (const f of moduleFiles) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/cnpj(\.server)?["']/);
      expect(src, f).not.toMatch(/regime_hint|regime_from_registry|cnpj_registry|counterparties/);
    }
  });

  it("as migrations do módulo não chamam regime_from_registry nem leem counterparties", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    for (const f of migrations) {
      const sql = stripSqlComments(readFileSync(join(root, f), "utf8"));
      expect(sql, f).not.toMatch(
        /regime_from_registry|cnpj_registry|counterparties|apply_registry/,
      );
    }
  });

  it("a regra existente segue no lugar (não foi alterada por este módulo)", () => {
    const server = readFileSync(join(root, "src/lib/cnpj.server.ts"), "utf8");
    expect(server).toMatch(/simples === false \? "presumido"/);
  });
});
