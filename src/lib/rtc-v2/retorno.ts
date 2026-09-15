/**
 * Lê o corpo devolvido pela Receita — no webhook ou na consulta de situação —
 * e diz o que ele é. A v1 manda tíquete de download; a v2 manda uma URL
 * pré-assinada. As duas convivem enquanto a v1 não for encerrada.
 *
 * A URL assinada é segredo temporário (48 h): quem usa esta função não pode
 * logá-la nem devolvê-la ao navegador.
 */
export type Retorno =
  | { tipo: "url"; url: string; expiraEm: string | null; tiquete: string | null }
  | { tipo: "tiquete"; tiquete: string }
  | { tipo: "erro"; codigo: string | null; mensagem: string | null }
  | { tipo: "desconhecido" };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function lerRetorno(corpo: unknown): Retorno {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { tipo: "desconhecido" };
  const o = corpo as Record<string, unknown>;

  const url = texto(o["urlAssinada"]);
  if (url) {
    // Só https: a URL carrega a autorização de download na própria query.
    if (!url.startsWith("https://")) return { tipo: "desconhecido" };
    return {
      tipo: "url",
      url,
      expiraEm: texto(o["urlAssinadaExpiraEm"]),
      tiquete: texto(o["tiqueteSolicitacao"]),
    };
  }

  const tiquete = texto(o["tiqueteDownload"]) ?? texto(o["tiquete"]);
  if (tiquete) return { tipo: "tiquete", tiquete };

  const codigo = texto(o["codigoErro"]);
  const mensagem = texto(o["mensagemErro"]);
  if (codigo || mensagem) return { tipo: "erro", codigo, mensagem };

  return { tipo: "desconhecido" };
}
