/**
 * Motivo provável da divergência entre a Receita e o nosso cálculo, em
 * linguagem de quem confere nota.
 *
 * Função pura, fora de `rtc.ts`, porque `rtc.ts` carrega o cliente do Supabase
 * e não roda em teste. `rtc.ts` reexporta com o mesmo nome.
 *
 * A regra que esta função existe para garantir: AUSENTE NÃO É ZERO. Antes,
 * `nosso_cents ?? 0` fazia a nota imune (calculada com zero) aparecer como "sem
 * correspondente", e diferença desconhecida aparecer como "Valores iguais".
 */
export type DocParaMotivo = {
  /** Existe nota nossa com a mesma chave. */
  tem_correspondente: boolean;
  /** CBS calculada por nós; `null` = não sabemos (sem nota, ou nota sem cálculo). */
  nosso_cents: number | null;
  /** Receita − nós; `null` quando não dá para calcular. */
  diferenca_cents: number | null;
  situacao: string | null;
};

export function motivoDivergencia(doc: DocParaMotivo): string {
  if (!doc.tem_correspondente) return "Nota na Receita sem correspondente aqui";
  if (doc.situacao === "cancelado") return "Documento cancelado na Receita";
  if (doc.nosso_cents === null) return "Nossa nota ainda não foi calculada";
  if (doc.diferenca_cents === null) return "Diferença não calculada";
  if (doc.diferenca_cents > 0) return "Receita apurou mais do que calculamos";
  if (doc.diferenca_cents < 0) return "Calculamos mais do que a Receita apurou";
  return "Valores iguais";
}
