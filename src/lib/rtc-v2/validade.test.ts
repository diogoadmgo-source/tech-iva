import { describe, expect, it } from "vitest";
import { expiracaoUrlAssinada, urlAssinadaUtilizavel, VALIDADE_URL_ASSINADA_MS } from "./validade";

const URL = "https://s3.exemplo/arquivo.json?assinatura=x";
const ABERTURA = "2026-10-01T10:00:00Z";
const T0 = Date.parse(ABERTURA);

describe("validade da url assinada da v2", () => {
  it("usa a expiração declarada quando ela vem", () => {
    expect(expiracaoUrlAssinada("2026-10-03T10:00:00Z", ABERTURA)).toBe(
      Date.parse("2026-10-03T10:00:00Z"),
    );
    expect(
      urlAssinadaUtilizavel({
        url: URL,
        expiraEm: "2026-10-03T10:00:00Z",
        solicitadoEm: ABERTURA,
        agora: T0 + 3600_000,
      }),
    ).toBe(true);
  });

  it("recusa quando a expiração declarada já passou", () => {
    expect(
      urlAssinadaUtilizavel({
        url: URL,
        expiraEm: "2026-10-03T10:00:00Z",
        solicitadoEm: ABERTURA,
        agora: Date.parse("2026-10-03T10:00:01Z"),
      }),
    ).toBe(false);
  });

  it("sem expiração, vale o piso de 48 h a partir da abertura", () => {
    expect(expiracaoUrlAssinada(null, ABERTURA)).toBe(T0 + VALIDADE_URL_ASSINADA_MS);
    // Campo opcional ausente NÃO pode dar a URL por perdida.
    for (const expiraEm of [null, undefined, "", "   "]) {
      expect(
        urlAssinadaUtilizavel({
          url: URL,
          expiraEm,
          solicitadoEm: ABERTURA,
          agora: T0 + 47 * 3600_000,
        }),
      ).toBe(true);
    }
    expect(
      urlAssinadaUtilizavel({
        url: URL,
        expiraEm: null,
        solicitadoEm: ABERTURA,
        agora: T0 + VALIDADE_URL_ASSINADA_MS + 1,
      }),
    ).toBe(false);
  });

  it("data malformada cai no mesmo piso, não derruba o download", () => {
    expect(expiracaoUrlAssinada("ontem de manhã", ABERTURA)).toBe(T0 + VALIDADE_URL_ASSINADA_MS);
    expect(
      urlAssinadaUtilizavel({
        url: URL,
        expiraEm: "ontem de manhã",
        solicitadoEm: ABERTURA,
        agora: T0 + 3600_000,
      }),
    ).toBe(true);
  });

  it("sem expiração e sem abertura legível, a URL segue utilizável", () => {
    expect(expiracaoUrlAssinada(null, null)).toBeNull();
    expect(urlAssinadaUtilizavel({ url: URL, expiraEm: null, solicitadoEm: null, agora: T0 })).toBe(
      true,
    );
  });

  it("sem URL não há o que usar, com ou sem expiração", () => {
    expect(
      urlAssinadaUtilizavel({ url: null, expiraEm: null, solicitadoEm: ABERTURA, agora: T0 }),
    ).toBe(false);
    expect(
      urlAssinadaUtilizavel({
        url: "   ",
        expiraEm: "2099-01-01T00:00:00Z",
        solicitadoEm: ABERTURA,
        agora: T0,
      }),
    ).toBe(false);
  });
});
