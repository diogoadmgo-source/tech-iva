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
