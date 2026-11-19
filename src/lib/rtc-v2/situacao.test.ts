import { describe, expect, it } from "vitest";
import { lerSituacao, situacaoFinal } from "./situacao";

describe("situação da solicitação v2", () => {
  it("lê o campo `situacao` da documentação 1.2", () => {
    expect(lerSituacao({ situacao: "CONCLUIDA" }).situacao).toBe("CONCLUIDA");
  });
  it("aceita `estado` só como reserva", () => {
    expect(lerSituacao({ estado: "PENDENTE" }).situacao).toBe("PENDENTE");
  });
  it("traz código e mensagem em EXPIRADA", () => {
    const l = lerSituacao({ situacao: "EXPIRADA", codigoErro: "EXPIRADA", mensagemErro: "240 minutos" });
    expect(l).toEqual({ situacao: "EXPIRADA", codigo: "EXPIRADA", mensagem: "240 minutos" });
    expect(situacaoFinal(l.situacao)).toBe(true);
  });
  it("valor desconhecido não vira concluída", () => {
    expect(lerSituacao({ situacao: "OK" }).situacao).toBe("DESCONHECIDA");
    expect(lerSituacao(null).situacao).toBe("DESCONHECIDA");
    expect(situacaoFinal("EM_PROCESSAMENTO")).toBe(false);
  });
});
