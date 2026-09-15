/**
 * Resposta imediata da abertura de solicitação na v2: HTTP 201 com
 * `{ tiqueteSolicitacao, tEASegundos }`. O tíquete é o que permite acompanhar a
 * solicitação pela consulta de situação — sem ele, só resta esperar o webhook.
 * O `tEASegundos` (tempo estimado de atendimento) evita consultar a situação
 * antes da hora, que seria chamada garantidamente inútil.
 *
 * Nada aqui é inventado: campo ausente ou fora do formato vira `null`, e quem
 * chama decide o que fazer — nunca um valor estimado.
 */
export type Abertura = {
  tiquete: string | null;
  teaSegundos: number | null;
};

function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
}

/** Aceita número ou texto numérico: alguns ambientes devolvem o tempo como string. */
function segundos(valor: unknown): number | null {
  if (typeof valor !== "number" && typeof valor !== "string") return null;
  if (typeof valor === "string" && !valor.trim()) return null;
  const n = typeof valor === "number" ? valor : Number(valor.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function lerAbertura(corpo: unknown): Abertura {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return { tiquete: null, teaSegundos: null };
  }
  const c = corpo as Record<string, unknown>;
  return {
    tiquete: texto(c["tiqueteSolicitacao"]),
    teaSegundos: segundos(c["tEASegundos"]),
  };
}
