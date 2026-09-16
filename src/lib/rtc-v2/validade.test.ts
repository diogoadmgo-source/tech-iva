import { describe, expect, it } from "vitest";
import {
  expiracaoUrlAssinada,
  tokenGuardadoUtilizavel,
  urlAssinadaUtilizavel,
  VALIDADE_TOKEN_MS,
  VALIDADE_URL_ASSINADA_MS,
} from "./validade";

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

describe("dá para confiar no token guardado?", () => {
  const ABERTURA = "2026-09-15T20:13:50.000Z";
  const T0 = Date.parse(ABERTURA);
  const REF = "secrets/t/rtc-session/a.enc";

  it("token recém-guardado serve", () => {
    // O caso real: o retorno chegou 1,5 s depois da abertura.
    expect(
      tokenGuardadoUtilizavel({ ref: REF, solicitadoEm: ABERTURA, agora: T0 + 1500 }),
    ).toBe(true);
  });

  it("serve até 55 minutos e não além", () => {
    const quase = T0 + VALIDADE_TOKEN_MS - 1000;
    const passou = T0 + VALIDADE_TOKEN_MS;
    expect(tokenGuardadoUtilizavel({ ref: REF, solicitadoEm: ABERTURA, agora: quase })).toBe(true);
    expect(tokenGuardadoUtilizavel({ ref: REF, solicitadoEm: ABERTURA, agora: passou })).toBe(false);
  });

  it("o reprocessamento do dia seguinte NÃO usa o token guardado", () => {
    // 16/09 17:03, quase 21 h depois: foi o caso que levou ao 401.
    const seguinte = Date.parse("2026-09-16T17:03:50.000Z");
    expect(
      tokenGuardadoUtilizavel({ ref: REF, solicitadoEm: ABERTURA, agora: seguinte }),
    ).toBe(false);
  });

  it("sem referência, não há token guardado", () => {
    for (const ref of [null, undefined, "", "   "]) {
      expect(tokenGuardadoUtilizavel({ ref, solicitadoEm: ABERTURA, agora: T0 })).toBe(false);
    }
  });

  it("sem abertura legível, a resposta é não", () => {
    // Assimetria proposital com urlAssinadaUtilizavel: lá a dúvida joga a favor
    // de tentar; aqui, insistir gasta o único acesso ao tíquete.
    for (const quando of [null, undefined, "", "ontem", "2026-13-45"]) {
      expect(tokenGuardadoUtilizavel({ ref: REF, solicitadoEm: quando, agora: T0 })).toBe(false);
    }
  });

  it("relógio adiantado no servidor não vence um token recém-criado", () => {
    // Diferença de relógio deixa o tempo decorrido negativo. Token que ainda
    // nem nasceu não pode estar vencido.
    expect(
      tokenGuardadoUtilizavel({ ref: REF, solicitadoEm: ABERTURA, agora: T0 - 60_000 }),
    ).toBe(true);
  });
});
