import { describe, expect, it } from "vitest";
import { EngineUnavailableError, normalizeCalc } from "./rtc-calc.server";

/**
 * Primeiro teste da camada que traduz a resposta do motor oficial.
 *
 * O defeito que estes testes existem para impedir: resposta 200 num formato
 * inesperado virava imposto R$ 0,00 com o selo "motor oficial" — porque a base
 * caía de volta para o valor digitado e só os tributos zeravam. A tela ficava
 * plausível e errada ao mesmo tempo.
 */

/** Formato real do motor, conforme o contrato no topo de rtc-calc.server.ts. */
function respostaBoa() {
  return {
    objetos: [
      {
        tribCalc: {
          IBSCBS: {
            gIBSCBS: {
              vBC: 1000,
              gCBS: { pCBS: 0.9, vCBS: 9, memoriaCalculo: "CBS com enquadramento legal em Art. 132, inciso I" },
              gIBSUF: { pIBSUF: 0.1, vIBSUF: 1 },
              gIBSMun: { pIBSMun: 0.05, vIBSMun: 0.5 },
            },
          },
          IS: { pIS: 0, vIS: 0 },
        },
      },
    ],
  };
}

describe("resposta bem formada", () => {
  it("lê cada tributo no lugar certo", () => {
    const r = normalizeCalc(respostaBoa(), 100_000, false);
    expect(r.cbs.valor_cents).toBe(900);
    expect(r.ibs_estadual.valor_cents).toBe(100);
    expect(r.ibs_municipal.valor_cents).toBe(50);
    expect(r.imposto_seletivo.valor_cents).toBe(0);
    expect(r.cbs.aliquota_pct).toBe(0.9);
  });

  it("soma o total e o valor da operação a partir da base do motor", () => {
    const r = normalizeCalc(respostaBoa(), 100_000, false);
    expect(r.base_cents).toBe(100_000); // vBC 1000 reais
    expect(r.tributo_total_cents).toBe(1050);
    expect(r.total_operacao_cents).toBe(101_050);
  });

  it("extrai a base legal da memória do motor", () => {
    expect(normalizeCalc(respostaBoa(), 100_000, false).memory.base_legal).toBe("Art. 132");
  });

  it("avisa quando o município foi o padrão", () => {
    const r = normalizeCalc(respostaBoa(), 100_000, true);
    expect(r.memory.passos.some((p) => p.passo === "Local da operação")).toBe(true);
  });
});

describe("resposta que não dá para entender: erro, nunca imposto zero", () => {
  it("recusa resposta vazia", () => {
    expect(() => normalizeCalc({}, 100_000, false)).toThrow(EngineUnavailableError);
  });

  it("recusa lista de objetos vazia", () => {
    expect(() => normalizeCalc({ objetos: [] }, 100_000, false)).toThrow(EngineUnavailableError);
  });

  it("recusa objeto sem tribCalc", () => {
    expect(() => normalizeCalc({ objetos: [{ outraCoisa: 1 }] }, 100_000, false)).toThrow(
      EngineUnavailableError,
    );
  });

  it("recusa quando o motor renomeia o envelope", () => {
    // O cenário real: a Receita publica versão nova e muda um nome.
    expect(() =>
      normalizeCalc({ resultados: [{ tribCalc: { IBSCBS: {} } }] }, 100_000, false),
    ).toThrow(EngineUnavailableError);
  });

  it("a mensagem diz que nada foi calculado, sem inventar valor", () => {
    try {
      normalizeCalc({}, 100_000, false);
      expect.unreachable("deveria ter lançado");
    } catch (e) {
      expect((e as Error).message).toContain("Nenhum valor foi calculado");
      expect((e as EngineUnavailableError).reason).toBe("error");
    }
  });
});

describe("operação legitimamente sem imposto continua válida", () => {
  it("envelope presente com tributos zerados devolve zero, não erro", () => {
    // Imunidade/isenção: o cálculo aconteceu e o resultado é zero. Isso não
    // pode virar "motor indisponível" — por isso a guarda é no envelope.
    const imune = {
      objetos: [{ tribCalc: { IBSCBS: { gIBSCBS: { vBC: 1000, gCBS: { pCBS: 0, vCBS: 0 } } } } }],
    };
    const r = normalizeCalc(imune, 100_000, false);
    expect(r.cbs.valor_cents).toBe(0);
    expect(r.tributo_total_cents).toBe(0);
    expect(r.base_cents).toBe(100_000);
  });
});
