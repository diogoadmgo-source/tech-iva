import { describe, expect, it } from "vitest";
import { lerDebitosV2 } from "./debitos";

const ARQUIVO = {
  tiqueteSolicitacao: "T-1",
  ni: "23813386",
  geradoEm: "2026-10-02T12:00:00Z",
  apuracao: [
    {
      pa: "09/2026",
      debitos: [
        {
          origem: 0,
          documento: 55,
          chave: "3526".padEnd(44, "9"),
          emissao: "2026-09-10T08:00:00Z",
          registro: "2026-09-10T08:10:00Z",
          atualizacao: "2026-09-11T08:10:00Z",
          cbs: { apurado: 18.29, extinto: 10.0, saldoDevedor: 8.29 },
        },
      ],
    },
  ],
};

describe("leitor de débitos v2", () => {
  it("achata apuracao[].debitos[] em linhas com o pa junto", () => {
    const linhas = lerDebitosV2(ARQUIVO);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      pa: "09/2026",
      origem: 0,
      documento: 55,
      apurado_cents: 1829,
      extinto_cents: 1000,
      saldo_devedor_cents: 829,
    });
  });

  it("trata os campos opcionais de cbs como zero", () => {
    const linhas = lerDebitosV2(ARQUIVO);
    expect(linhas[0]?.excedente_cents).toBe(0);
    expect(linhas[0]?.inexigivel_cents).toBe(0);
    expect(linhas[0]?.suspenso_cents).toBe(0);
  });

  it("lê vários períodos no mesmo arquivo", () => {
    const dois = {
      ...ARQUIVO,
      apuracao: [ARQUIVO.apuracao[0], { ...ARQUIVO.apuracao[0], pa: "08/2026" }],
    };
    expect(lerDebitosV2(dois).map((l) => l.pa)).toEqual(["09/2026", "08/2026"]);
  });

  it("devolve lista vazia para arquivo vazio ou malformado, sem lançar", () => {
    expect(lerDebitosV2({})).toEqual([]);
    expect(lerDebitosV2(null)).toEqual([]);
    expect(lerDebitosV2({ apuracao: "nao e lista" })).toEqual([]);
    expect(lerDebitosV2({ apuracao: [{ pa: "09/2026" }] })).toEqual([]);
  });

  it("aceita a chave como número sem perder dígito", () => {
    // Um `chNFe` que veio como número já custou uma rodada no passado.
    const comNumero = {
      ...ARQUIVO,
      apuracao: [{ pa: "09/2026", debitos: [{ ...ARQUIVO.apuracao[0]!.debitos[0], chave: 35269 }] }],
    };
    expect(lerDebitosV2(comNumero)[0]?.chave).toBe("35269");
  });
});
