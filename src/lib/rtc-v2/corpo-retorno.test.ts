import { describe, expect, it } from "vitest";
import { lerCorpoRetorno, metaDaRequisicao, TAMANHO_MAXIMO_RETORNO } from "./corpo-retorno";

describe("corpo do retorno da Receita", () => {
  it("objeto JSON passa inteiro", () => {
    const c = lerCorpoRetorno('{"tiqueteDownload":"abc"}');
    expect(c).toEqual({ tipo: "objeto", payload: { tiqueteDownload: "abc" } });
  });

  it("texto que não é JSON é guardado, não descartado", () => {
    // Não sabemos o formato real do retorno v1. Se vier como formulário ou
    // texto, a evidência tem que ficar.
    const c = lerCorpoRetorno("tiquete=abc&status=ok");
    expect(c.tipo).toBe("nao_objeto");
    if (c.tipo === "nao_objeto") {
      expect(c.payload._bruto).toBe("tiquete=abc&status=ok");
      expect(c.payload._motivo).toBe("nao_json");
    }
  });

  it("JSON que não é objeto (lista, número, texto) também é guardado", () => {
    for (const bruto of ["[1,2]", "42", '"x"', "null"]) {
      const c = lerCorpoRetorno(bruto);
      expect(c.tipo).toBe("nao_objeto");
      if (c.tipo === "nao_objeto") expect(c.payload._motivo).toBe("nao_objeto");
    }
  });

  it("guarda no máximo 4000 caracteres do texto bruto", () => {
    const c = lerCorpoRetorno("x".repeat(10_000));
    if (c.tipo !== "nao_objeto") throw new Error("esperava nao_objeto");
    expect(c.payload._bruto.length).toBe(4000);
  });

  it("corpo acima do limite é recusado sem ser lido para o banco", () => {
    expect(lerCorpoRetorno("x".repeat(TAMANHO_MAXIMO_RETORNO + 1))).toEqual({ tipo: "grande_demais" });
    expect(lerCorpoRetorno("x".repeat(TAMANHO_MAXIMO_RETORNO)).tipo).not.toBe("grande_demais");
  });

  it("o limite conta bytes, não caracteres (acento ocupa mais de um byte)", () => {
    const quaseLimiteEmCaracteres = "é".repeat(TAMANHO_MAXIMO_RETORNO / 2 + 1);
    expect(lerCorpoRetorno(quaseLimiteEmCaracteres)).toEqual({ tipo: "grande_demais" });
  });

  it("corpo vazio é guardado como não-JSON", () => {
    expect(lerCorpoRetorno("").tipo).toBe("nao_objeto");
  });
});

describe("quem chamou", () => {
  it("guarda tipo de conteúdo, agente e origem — para provar que foi a Receita", () => {
    const h = new Headers({
      "content-type": "application/json",
      "user-agent": "Java/21",
      "x-forwarded-for": "200.198.1.1, 10.0.0.1",
    });
    expect(metaDaRequisicao(h, 42)).toEqual({
      content_type: "application/json",
      user_agent: "Java/21",
      origem_ip: "200.198.1.1",
      tamanho: 42,
    });
  });

  it("cabeçalho ausente vira null, não texto inventado", () => {
    expect(metaDaRequisicao(new Headers(), 0)).toEqual({
      content_type: null,
      user_agent: null,
      origem_ip: null,
      tamanho: 0,
    });
  });

  it("corta cabeçalhos longos", () => {
    const m = metaDaRequisicao(new Headers({ "user-agent": "a".repeat(1000) }), 1);
    expect(m.user_agent?.length).toBe(200);
  });
});
