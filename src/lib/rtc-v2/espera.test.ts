import { describe, expect, it } from "vitest";
import {
  avisoAposSolicitar,
  cedoDemaisParaBaixar,
  ESPERA_MINIMA_DOWNLOAD_MS,
  liberacaoDoDownload,
  minutosDeEspera,
} from "./espera";

const RETORNO = "2026-09-23T11:59:49.000Z";
const T0 = Date.parse(RETORNO);

describe("cedo demais para baixar?", () => {
  it("logo depois do retorno é cedo demais — o caso de 23/09", () => {
    // O retorno chegou 1,5 s depois do pedido; baixar aí queimava o tíquete.
    expect(cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: T0 + 1_500 })).toBe(true);
  });

  it("libera exatamente quando a espera termina", () => {
    const fim = T0 + ESPERA_MINIMA_DOWNLOAD_MS;
    expect(cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: fim - 1 })).toBe(true);
    expect(cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: fim })).toBe(false);
  });

  it("sem retorno registrado, conta a partir do pedido", () => {
    expect(cedoDemaisParaBaixar({ recebidoEm: null, solicitadoEm: RETORNO, agora: T0 + 60_000 })).toBe(true);
    expect(liberacaoDoDownload({ recebidoEm: null, solicitadoEm: RETORNO, agora: 0 })).toBe(
      T0 + ESPERA_MINIMA_DOWNLOAD_MS,
    );
  });

  it("o retorno tem prioridade sobre o pedido", () => {
    const pedido = "2026-09-23T11:00:00.000Z";
    expect(liberacaoDoDownload({ recebidoEm: RETORNO, solicitadoEm: pedido, agora: 0 })).toBe(
      T0 + ESPERA_MINIMA_DOWNLOAD_MS,
    );
  });

  it("sem nenhuma data legível não bloqueia", () => {
    // Na prática inalcançável — o banco grava as duas datas sozinho. Bloquear
    // aqui prenderia a linha para sempre sem ninguém conseguir destravar.
    for (const ruim of [null, undefined, "", "ontem"]) {
      expect(cedoDemaisParaBaixar({ recebidoEm: ruim, solicitadoEm: ruim, agora: T0 })).toBe(false);
      expect(liberacaoDoDownload({ recebidoEm: ruim, solicitadoEm: ruim, agora: T0 })).toBeNull();
    }
  });

  it("dia seguinte está liberado", () => {
    expect(
      cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: T0 + 24 * 3600_000 }),
    ).toBe(false);
  });
});

describe("aviso depois de consultar a Receita", () => {
  it("diz os minutos a partir da constante, sem número fixo", () => {
    expect(minutosDeEspera()).toBe(Math.ceil(ESPERA_MINIMA_DOWNLOAD_MS / 60_000));
    expect(avisoAposSolicitar()).toContain(`daqui a ${minutosDeEspera()} minuto`);
  });

  it("manda clicar em Reprocessar retorno uma vez, e não promete atualizar sozinha", () => {
    const aviso = avisoAposSolicitar();
    expect(aviso).toContain('"Reprocessar retorno"');
    expect(aviso).toContain("uma vez");
    expect(aviso).not.toMatch(/sozinh/);
  });

  it("arredonda para cima e acerta o singular", () => {
    expect(minutosDeEspera(90_000)).toBe(2);
    expect(minutosDeEspera(60_000)).toBe(1);
    expect(avisoAposSolicitar(60_000)).toContain("daqui a 1 minuto.");
    expect(avisoAposSolicitar(10 * 60_000)).toContain("daqui a 10 minutos.");
  });
});
