/**
 * Veredito do quadro "Receita × nosso cálculo" da apuração.
 *
 * Função pura, fora de `rtc.ts`, porque `rtc.ts` carrega o cliente do Supabase
 * e não roda em teste.
 *
 * A regra que esta função existe para garantir: AUSENTE NÃO É ZERO. A função
 * do banco `apuracao_divergencia` fazia `coalesce(debitos_cents, 0) - nosso`,
 * e nenhuma rotina grava `debitos_cents` — então toda apuração recebida
 * aparecia com "Débito apurado pela Receita: R$ 0,00" e divergência igual ao
 * nosso cálculo inteiro. A migração 0233 tira o zero do banco; esta função
 * garante o mesmo na tela mesmo antes de a migração ser aplicada: sem o débito
 * da Receita não existe comparação, qualquer que seja a diferença recebida.
 */
export type DivergenciaRecebida = {
  receita_debito_cents: number | null;
  nosso_debito_cents: number | null;
  diferenca_cents: number | null;
  divergente: boolean | null;
};

export type ComparacaoApuracao =
  | { estado: "sem_comparacao"; motivo: string }
  | { estado: "bate"; diferencaCents: number }
  | { estado: "diverge"; diferencaCents: number };

export const MOTIVO_SEM_DEBITO_RECEITA =
  "A Receita não informou o débito total desta competência. Sem ele não dá para comparar com o seu cálculo.";

export const MOTIVO_SEM_DIFERENCA = "Não foi possível calcular a diferença desta competência.";

export function compararApuracao(d: DivergenciaRecebida): ComparacaoApuracao {
  if (d.receita_debito_cents === null || d.receita_debito_cents === undefined) {
    return { estado: "sem_comparacao", motivo: MOTIVO_SEM_DEBITO_RECEITA };
  }
  if (
    d.nosso_debito_cents === null ||
    d.nosso_debito_cents === undefined ||
    d.diferenca_cents === null ||
    d.diferenca_cents === undefined ||
    d.divergente === null ||
    d.divergente === undefined
  ) {
    return { estado: "sem_comparacao", motivo: MOTIVO_SEM_DIFERENCA };
  }
  return d.divergente
    ? { estado: "diverge", diferencaCents: d.diferenca_cents }
    : { estado: "bate", diferencaCents: d.diferenca_cents };
}
