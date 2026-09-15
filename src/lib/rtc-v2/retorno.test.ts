import { describe, expect, it } from "vitest";
import { lerRetorno } from "./retorno";

describe("leitura do retorno da Receita", () => {
  it("reconhece o retorno v2 com url assinada", () => {
    expect(
      lerRetorno({
        tiqueteSolicitacao: "T-1",
        urlAssinada: "https://s3.exemplo/arquivo.json?assinatura=x",
        urlAssinadaExpiraEm: "2026-10-03T10:00:00Z",
      }),
    ).toEqual({
      tipo: "url",
      url: "https://s3.exemplo/arquivo.json?assinatura=x",
      expiraEm: "2026-10-03T10:00:00Z",
      tiquete: "T-1",
    });
  });

  it("aceita url assinada sem expiração — o campo é opcional no retorno", () => {
    // Quem decide se ela ainda vale é `urlAssinadaUtilizavel` (rtc-v2/validade),
    // que sem expiração declarada usa o piso de 48 h da abertura. Aqui só se
    // registra que o corpo é legítimo e `expiraEm` fica nulo.
    expect(lerRetorno({ urlAssinada: "https://s3.exemplo/a.json?x=1" })).toEqual({
      tipo: "url",
      url: "https://s3.exemplo/a.json?x=1",
      expiraEm: null,
      tiquete: null,
    });
  });

  it("reconhece o retorno v1 com tíquete de download", () => {
    expect(lerRetorno({ tiqueteDownload: "D-9" })).toEqual({ tipo: "tiquete", tiquete: "D-9" });
    expect(lerRetorno({ tiquete: "D-9" })).toEqual({ tipo: "tiquete", tiquete: "D-9" });
  });

  it("reconhece o retorno de erro", () => {
    expect(lerRetorno({ codigoErro: "E42", mensagemErro: "deu ruim" })).toEqual({
      tipo: "erro",
      codigo: "E42",
      mensagem: "deu ruim",
    });
  });

  it("recusa url que não seja https, para não virar caminho de vazamento", () => {
    expect(lerRetorno({ urlAssinada: "http://s3.exemplo/a.json" }).tipo).toBe("desconhecido");
    expect(lerRetorno({ urlAssinada: "ftp://s3.exemplo/a.json" }).tipo).toBe("desconhecido");
  });

  it("devolve desconhecido para corpo vazio ou sem os campos esperados", () => {
    expect(lerRetorno({}).tipo).toBe("desconhecido");
    expect(lerRetorno(null).tipo).toBe("desconhecido");
    expect(lerRetorno("texto").tipo).toBe("desconhecido");
    expect(lerRetorno([]).tipo).toBe("desconhecido");
  });
});
