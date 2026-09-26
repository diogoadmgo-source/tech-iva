import { describe, expect, it } from "vitest";
import { MENSAGEM_BANCO_DESATUALIZADO, exigirLinhasAtualizadas } from "./conciliacao-linhas";

describe("exigirLinhasAtualizadas", () => {
  it("lista vazia passa e devolve []", () => {
    expect(exigirLinhasAtualizadas([])).toEqual([]);
  });

  it("linhas com tem_correspondente true e false passam e voltam inalteradas", () => {
    const linhas = [{ tem_correspondente: true, x: 1 }, { tem_correspondente: false, x: 2 }];
    expect(exigirLinhasAtualizadas(linhas)).toBe(linhas);
    expect(exigirLinhasAtualizadas(linhas)).toEqual([
      { tem_correspondente: true, x: 1 },
      { tem_correspondente: false, x: 2 },
    ]);
  });

  it("linha sem o campo lança com MENSAGEM_BANCO_DESATUALIZADO", () => {
    expect(() => exigirLinhasAtualizadas([{ x: 1 }])).toThrow(MENSAGEM_BANCO_DESATUALIZADO);
  });

  it("linha com tem_correspondente null lança", () => {
    expect(() => exigirLinhasAtualizadas([{ tem_correspondente: null }])).toThrow(
      MENSAGEM_BANCO_DESATUALIZADO,
    );
  });

  it("linha com tem_correspondente string 'true' lança", () => {
    expect(() => exigirLinhasAtualizadas([{ tem_correspondente: "true" }])).toThrow(
      MENSAGEM_BANCO_DESATUALIZADO,
    );
  });

  it("lista onde só a ÚLTIMA linha é ruim lança", () => {
    const linhas = [
      { tem_correspondente: true },
      { tem_correspondente: false },
      { tem_correspondente: undefined },
    ];
    expect(() => exigirLinhasAtualizadas(linhas)).toThrow(MENSAGEM_BANCO_DESATUALIZADO);
  });
});
