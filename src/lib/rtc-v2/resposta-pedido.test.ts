import { describe, expect, it } from "vitest";
import { lerRespostaPedidoV1 } from "./resposta-pedido";

/**
 * O defeito que estes testes existem para impedir: o `tiquete` da resposta ao
 * pedido era tratado como comprovante de DOWNLOAD. Não é — o manual, Passo 2:
 * "Retorno: tíquete da solicitação". Três downloads com ele (15/09, 23/09,
 * 26/09) voltaram 401 "Tíquete inexistente ou download já realizado".
 */
describe("resposta ao pedido (v1)", () => {
  it("o `tiquete` da resposta é o da SOLICITAÇÃO, nunca o de download — o caso real", () => {
    const r = lerRespostaPedidoV1({ tiquete: "937c1446-eabd-498c-9679-d70ec962507b.4C6ADADB" });
    expect(r.tiqueteSolicitacao).toBe("937c1446-eabd-498c-9679-d70ec962507b.4C6ADADB");
    expect(r.tiqueteDownload).toBeNull();
  });

  it("só um campo explicitamente de download conta como download", () => {
    const r = lerRespostaPedidoV1({ tiqueteSolicitacao: "S", tiqueteDownload: "D" });
    expect(r).toEqual({ tiqueteSolicitacao: "S", tiqueteDownload: "D" });
  });

  it("tiqueteSolicitacao tem prioridade sobre tiquete", () => {
    expect(lerRespostaPedidoV1({ tiqueteSolicitacao: "S", tiquete: "T" }).tiqueteSolicitacao).toBe("S");
  });

  it("valor vazio, com espaço ou de outro tipo é ausência, não comprovante", () => {
    for (const ruim of ["", "   ", null, 123, {}, []]) {
      expect(lerRespostaPedidoV1({ tiquete: ruim, tiqueteDownload: ruim })).toEqual({
        tiqueteSolicitacao: null,
        tiqueteDownload: null,
      });
    }
  });

  it("apara espaços em volta", () => {
    expect(lerRespostaPedidoV1({ tiquete: "  abc  " }).tiqueteSolicitacao).toBe("abc");
  });

  it("resposta que não é objeto não inventa nada", () => {
    for (const corpo of [null, undefined, "x", 1, [], ["tiquete"]]) {
      expect(lerRespostaPedidoV1(corpo)).toEqual({ tiqueteSolicitacao: null, tiqueteDownload: null });
    }
  });
});
