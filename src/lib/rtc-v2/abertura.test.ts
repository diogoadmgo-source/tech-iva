import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { abrirNaReceitaV2 } from "../rtc-apuracao.server";
import { lerAbertura } from "./abertura";

/**
 * Servidor de mentira no lugar da Receita. O que importa aqui é o que SAI
 * daqui: endereço, corpo e cabeçalho da chamada de abertura. Errar qualquer um
 * dos três queima uma das 4 chamadas do dia sem produzir apuração.
 */
type Recebida = {
  metodo: string | undefined;
  caminho: string | undefined;
  autorizacao: string | undefined;
  corpo: string;
};

let servidor: http.Server;
let base: string;
let recebidas: Recebida[] = [];
let resposta = { status: 201, corpo: JSON.stringify({ tiqueteSolicitacao: "T-77", tEASegundos: 120 }) };

const ENV_URL = process.env["RTC_API_URL"];
const ENV_PREFIX = process.env["RTC_API_PREFIX"];

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (pedaco) => (corpo += pedaco));
    req.on("end", () => {
      recebidas.push({
        metodo: req.method,
        caminho: req.url,
        autorizacao: req.headers["authorization"],
        corpo,
      });
      res.writeHead(resposta.status, { "Content-Type": "application/json" });
      res.end(resposta.corpo);
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  process.env["RTC_API_URL"] = base;
});

afterAll(async () => {
  await new Promise<void>((pronto) => servidor.close(() => pronto()));
  if (ENV_URL === undefined) delete process.env["RTC_API_URL"];
  else process.env["RTC_API_URL"] = ENV_URL;
  if (ENV_PREFIX === undefined) delete process.env["RTC_API_PREFIX"];
  else process.env["RTC_API_PREFIX"] = ENV_PREFIX;
});

beforeEach(() => {
  recebidas = [];
  resposta = { status: 201, corpo: JSON.stringify({ tiqueteSolicitacao: "T-77", tEASegundos: 120 }) };
  delete process.env["RTC_API_PREFIX"];
});

const URL_RETORNO = "https://app.exemplo.com.br/api/public/rtc/apuracao/" + "a".repeat(48);

describe("abertura da solicitação na v2", () => {
  it("chama o caminho do recurso pedido, com o CNPJ básico de 8 dígitos", async () => {
    await abrirNaReceitaV2("12.345.678/0001-99", "creditos", URL_RETORNO, "tok-1");
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]?.metodo).toBe("POST");
    expect(recebidas[0]?.caminho).toBe("/apuracao-cbs/v2/creditos/12345678");
  });

  it("usa o caminho da produção restrita quando o ambiente é o restrito", async () => {
    process.env["RTC_API_PREFIX"] = "prr-rtc";
    await abrirNaReceitaV2("12345678000199", "debitos", URL_RETORNO, "tok-1");
    expect(recebidas[0]?.caminho).toBe("/apuracao-cbs-prr/v2/debitos/12345678");
  });

  it("manda no corpo a urlRetorno e nada mais", async () => {
    await abrirNaReceitaV2("12345678000199", "pagamentos", URL_RETORNO, "tok-1");
    const corpo = JSON.parse(recebidas[0]?.corpo ?? "{}") as Record<string, unknown>;
    expect(Object.keys(corpo)).toEqual(["urlRetorno"]);
    expect(corpo["urlRetorno"]).toBe(URL_RETORNO);
  });

  it("autentica com Bearer, nunca com a credencial crua", async () => {
    await abrirNaReceitaV2("12345678000199", "recolhimentos", URL_RETORNO, "tok-secreto");
    expect(recebidas[0]?.autorizacao?.startsWith("Bearer ")).toBe(true);
    expect(recebidas[0]?.autorizacao).toBe("Bearer tok-secreto");
  });

  it("devolve o tíquete e o tempo estimado que vieram no 201", async () => {
    const { body } = await abrirNaReceitaV2("12345678000199", "debitos", URL_RETORNO, "tok-1");
    expect(lerAbertura(body)).toEqual({ tiquete: "T-77", teaSegundos: 120 });
  });

  it("explica a recusa da Receita em vez de seguir como se tivesse aberto", async () => {
    resposta = { status: 429, corpo: JSON.stringify({ mensagemErro: "limite diario atingido" }) };
    await expect(
      abrirNaReceitaV2("12345678000199", "debitos", URL_RETORNO, "tok-1"),
    ).rejects.toThrow(/limite diario atingido/);
  });
});

describe("leitura da resposta de abertura", () => {
  it("lê o tíquete e o tempo estimado de atendimento", () => {
    expect(lerAbertura({ tiqueteSolicitacao: "T-1", tEASegundos: 300 })).toEqual({
      tiquete: "T-1",
      teaSegundos: 300,
    });
  });

  it("aceita o tempo estimado em texto, como alguns ambientes devolvem", () => {
    expect(lerAbertura({ tiqueteSolicitacao: "T-1", tEASegundos: "300" })).toEqual({
      tiquete: "T-1",
      teaSegundos: 300,
    });
  });

  it("devolve nulo no que não veio, em vez de inventar valor", () => {
    expect(lerAbertura({})).toEqual({ tiquete: null, teaSegundos: null });
    expect(lerAbertura(null)).toEqual({ tiquete: null, teaSegundos: null });
    expect(lerAbertura("texto")).toEqual({ tiquete: null, teaSegundos: null });
    expect(lerAbertura({ tiqueteSolicitacao: "   " })).toEqual({ tiquete: null, teaSegundos: null });
  });

  it("recusa tempo estimado que não seja número finito e não negativo", () => {
    expect(lerAbertura({ tEASegundos: -1 }).teaSegundos).toBeNull();
    expect(lerAbertura({ tEASegundos: "muito" }).teaSegundos).toBeNull();
    expect(lerAbertura({ tEASegundos: Infinity }).teaSegundos).toBeNull();
  });
});
