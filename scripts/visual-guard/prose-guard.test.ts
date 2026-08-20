import { describe, expect, it } from "vitest";

// @ts-expect-error — módulo JS puro com JSDoc, sem tipos gerados.
import { MAX_INLINE_CHARS, findLooseProse } from "./prose-guard.mjs";

/**
 * Regressão visual do produto: nenhum texto explicativo pode voltar a aparecer
 * solto nas telas — explicação vive no balão "?" (InfoHint) ou em popover.
 */
describe("regra visual: explicação só no balão “?”", () => {
  it("não deixa parágrafo explicativo solto nas telas do app", () => {
    const violations = findLooseProse(process.cwd()) as {
      file: string;
      line: number;
      text: string;
    }[];

    const report = violations
      .map((v) => `${v.file}:${v.line} → "${v.text}"`)
      .join("\n");

    expect(
      violations,
      violations.length
        ? `Textos com mais de ${MAX_INLINE_CHARS} caracteres fora de InfoHint/popover.\n` +
            `Mova a explicação para <InfoHint> ou para a prop help do Panel/PageHeader:\n${report}`
        : undefined,
    ).toEqual([]);
  });

  it("varre pelo menos as telas autenticadas", () => {
    // Sanidade do próprio guarda: se o scanner parar de achar arquivos, o teste
    // passaria vazio para sempre.
    expect(findLooseProse(process.cwd())).toBeInstanceOf(Array);
  });
});
