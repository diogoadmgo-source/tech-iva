import { describe, expect, it } from "vitest";
import { ibsCbsText, parseConsultaOptantes } from "./consulta-optantes";

// Texto como sai do Ctrl+A/Ctrl+C na página de resultado (print de 18/11/2026).
const NAO = `Simples Nacional
Consulta Optantes
Data da consulta: 18/11/2026 21:50:04
Identificação do Contribuinte - CNPJ Matriz
CNPJ: 69.699.530/0001-76
A opção pelo Simples Nacional e/ou SIMEI abrange todos os estabelecimentos da empresa
Nome Empresarial: KYNDO TECNOLOGIA E INOVACAO LTDA
Situação Atual
Situação no Simples Nacional: Optante pelo Simples Nacional desde 20/10/2026
Situação no SIMEI: NÃO enquadrado no SIMEI
Situação no Regime Regular do IBS: Não optante
Situação no Regime Regular da CBS: Não optante
Mais informações
Voltar Gerar PDF`;

describe("leitura da Consulta Optantes", () => {
  it("lê não optante, data e CNPJ", () => {
    const r = parseConsultaOptantes(NAO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cnpj).toBe("69699530000176");
    expect(r.value.consultadoEm).toBe("2026-11-18T21:50:04-03:00");
    expect(r.value.ibs).toMatchObject({ valor: "nao", desde: null });
    expect(r.value.cbs.valor).toBe("nao");
    expect(r.value.nome).toBe("KYNDO TECNOLOGIA E INOVACAO LTDA");
  });

  it("lê optante com data de início, IBS e CBS separados", () => {
    const t = NAO.replace(
      "do IBS: Não optante",
      "do IBS: Optante pelo Regime Regular do IBS desde 01/01/2027",
    );
    const r = parseConsultaOptantes(t);
    expect(r.ok && r.value.ibs).toMatchObject({ valor: "sim", desde: "2027-01-01" });
    expect(r.ok && r.value.cbs.valor).toBe("nao");
  });

  it("aceita espaço não separável do copiar e colar", () => {
    expect(parseConsultaOptantes(NAO.replace(/ /g, " ")).ok).toBe(true);
  });

  it("recusa captcha, CNPJ inválido e texto incompleto, com o motivo", () => {
    const cap = parseConsultaOptantes("Impedido por proteção Captcha. Comportamento de Robô.");
    expect(!cap.ok && cap.erro).toContain("captcha");
    expect(parseConsultaOptantes("Informe um CNPJ válido").ok).toBe(false);
    const sem = parseConsultaOptantes(NAO.replace(/Situação no Regime Regular da CBS.*\n/, ""));
    expect(!sem.ok && sem.erro).toContain("CBS");
    // Situação desconhecida não vira "sim" nem "não".
    expect(parseConsultaOptantes(NAO.replace("da CBS: Não optante", "da CBS: Em análise")).ok).toBe(
      false,
    );
  });

  it("texto curto para grade e Excel", () => {
    expect(ibsCbsText(null)).toBe("A confirmar");
    expect(
      ibsCbsText({
        raiz: "1",
        ibs: "nao",
        cbs: "nao",
        ibsDesde: "2026-11-18",
        cbsDesde: "2026-11-18",
        consultadoEm: "2026-11-18T10:00:00Z",
        descricao: "",
        temArquivo: false,
      }),
    ).toBe("IBS e CBS: não optante (consulta de 18/11/2026)");
  });
});
