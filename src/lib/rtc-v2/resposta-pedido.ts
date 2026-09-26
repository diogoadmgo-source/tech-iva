/**
 * O que a resposta ao PEDIDO de apuração (API v1, HTTP 201) traz de verdade.
 *
 * O manual (Plataforma CBS, Passo 2) é explícito: "Retorno: tíquete da
 * solicitação". O comprovante de DOWNLOAD — o "TíqueteDownload" do texto do
 * manual — chega depois, pelo endereço de retorno (webhook), quando a Receita
 * termina de preparar o arquivo.
 *
 * O código antigo lia o `tiquete` desta resposta como se fosse o de download,
 * fingia ter recebido o retorno da Receita, tentava baixar com ele e fechava o
 * endereço de retorno. Resultado nos três testes reais (15/09, 23/09, 26/09):
 * 401 "Tíquete inexistente ou download já realizado", e o retorno verdadeiro,
 * se viesse, seria recusado.
 *
 * Regra: só um campo explicitamente de download (`tiqueteDownload`) conta como
 * download. `tiquete` / `tiqueteSolicitacao` são o comprovante do pedido.
 * Valor vazio ou de outro tipo é ausência — nunca um comprovante inventado.
 */
export type RespostaPedido = {
  tiqueteSolicitacao: string | null;
  tiqueteDownload: string | null;
};

function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
}

export function lerRespostaPedidoV1(corpo: unknown): RespostaPedido {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return { tiqueteSolicitacao: null, tiqueteDownload: null };
  }
  const c = corpo as Record<string, unknown>;
  return {
    tiqueteSolicitacao: texto(c["tiqueteSolicitacao"]) ?? texto(c["tiquete"]),
    tiqueteDownload: texto(c["tiqueteDownload"]),
  };
}
