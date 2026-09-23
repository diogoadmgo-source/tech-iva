import { describe, expect, it } from "vitest";
import { hojeEmSaoPaulo, mesCorrenteEmSaoPaulo } from "./datas";

/**
 * O caso que importa é a faixa das 21h à meia-noite em São Paulo, quando o
 * servidor em UTC já virou o dia. É nela que o jeito antigo
 * (`toISOString().slice(0,10)`) erra.
 */
describe("hoje no fuso de São Paulo", () => {
  it("às 21h30 de São Paulo ainda é o mesmo dia, não o seguinte", () => {
    // 2026-12-31 21:30 em São Paulo = 2027-01-01 00:30 em UTC.
    const agora = new Date("2027-01-01T00:30:00Z");
    expect(hojeEmSaoPaulo(agora)).toBe("2026-12-31");
    // prova de que o jeito antigo erraria — e erraria de ANO
    expect(agora.toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("logo depois da meia-noite em São Paulo já é o dia novo", () => {
    // 2027-01-01 00:30 em São Paulo = 2027-01-01 03:30 em UTC.
    expect(hojeEmSaoPaulo(new Date("2027-01-01T03:30:00Z"))).toBe("2027-01-01");
  });

  it("no meio do dia os dois jeitos concordam", () => {
    const agora = new Date("2026-09-23T15:00:00Z"); // 12h em São Paulo
    expect(hojeEmSaoPaulo(agora)).toBe("2026-09-23");
    expect(agora.toISOString().slice(0, 10)).toBe("2026-09-23");
  });

  it("horário de verão do hemisfério norte não desloca São Paulo", () => {
    // São Paulo não tem horário de verão desde 2019: UTC-3 o ano todo.
    expect(hojeEmSaoPaulo(new Date("2026-07-15T02:30:00Z"))).toBe("2026-07-14");
    expect(hojeEmSaoPaulo(new Date("2026-01-15T02:30:00Z"))).toBe("2026-01-14");
  });

  it("devolve sempre no formato AAAA-MM-DD", () => {
    for (const iso of ["2026-01-01T00:00:00Z", "2026-11-05T23:59:59Z", "2027-03-09T12:00:00Z"]) {
      expect(hojeEmSaoPaulo(new Date(iso))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("mês corrente no fuso de São Paulo", () => {
  it("na virada do mês, 21h30 ainda é o mês que está terminando", () => {
    // 2026-09-30 21:30 em São Paulo = 2026-10-01 00:30 em UTC.
    expect(mesCorrenteEmSaoPaulo(new Date("2026-10-01T00:30:00Z"))).toBe("2026-09-01");
  });

  it("depois da virada, é o mês novo", () => {
    expect(mesCorrenteEmSaoPaulo(new Date("2026-10-01T03:30:00Z"))).toBe("2026-10-01");
  });

  it("sempre no dia 1º", () => {
    for (const iso of ["2026-02-15T12:00:00Z", "2026-12-31T12:00:00Z"]) {
      expect(mesCorrenteEmSaoPaulo(new Date(iso))).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });
});
