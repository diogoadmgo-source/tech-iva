/**
 * Paginação de servidor — regra de ouro do projeto.
 *
 * O PostgREST corta QUALQUER select em 1000 linhas por padrão, sem erro e sem
 * aviso. Uma tela que lê lista sem `.range()` mostra número plausível e errado
 * (foi exatamente assim que a projeção de caixa passou a usar 1,3% dos
 * recebíveis). Então:
 *
 *  - toda consulta de lista usa `.range()` com ordenação ESTÁVEL (desempate por
 *    coluna única, senão a mesma linha aparece em duas páginas);
 *  - toda contagem exibida na tela vem de `count: "exact"` do servidor, NUNCA
 *    de `data.length`;
 *  - quando é preciso mesmo varrer tudo (ex.: ids de escopo), use
 *    `fetchAllPages`, que percorre página por página até o fim.
 */

export const DEFAULT_PAGE_SIZE = 50;

/** Tamanhos oferecidos ao usuário. Nunca "todos". */
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export type Paged<T> = {
  rows: T[];
  /** contagem EXATA do servidor (count: "exact"), não o tamanho do array. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Intervalo [from, to] para `.range()`. */
export function rangeOf(page: number, pageSize: number): [number, number] {
  const from = Math.max(0, page) * pageSize;
  return [from, from + pageSize - 1];
}

export function paged<T>(rows: T[], total: number, page: number, pageSize: number): Paged<T> {
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function emptyPage<T>(page = 0, pageSize = DEFAULT_PAGE_SIZE): Paged<T> {
  return { rows: [] as T[], total: 0, page, pageSize, pageCount: 1 };
}

/** Texto padrão "1–50 de 100.000". */
export function pageLabel(p: { page: number; pageSize: number; total: number }): string {
  if (p.total === 0) return "0 de 0";
  const from = p.page * p.pageSize + 1;
  const to = Math.min(p.total, (p.page + 1) * p.pageSize);
  return `${from.toLocaleString("pt-BR")}–${to.toLocaleString("pt-BR")} de ${p.total.toLocaleString("pt-BR")}`;
}

type PageFetcher<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Varre TODAS as páginas de uma consulta (para casos em que o conjunto completo
 * é realmente necessário). `hardCap` evita travar o navegador: se estourar,
 * lança em vez de devolver dado incompleto silenciosamente.
 */
export async function fetchAllPages<T>(
  fetchPage: PageFetcher<T>,
  { pageSize = 1000, hardCap = 50_000 }: { pageSize?: number; hardCap?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page += 1) {
    const [from, to] = rangeOf(page, pageSize);
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) return out;
    if (out.length >= hardCap) {
      throw new Error(
        `Consulta acima do limite de ${hardCap.toLocaleString("pt-BR")} linhas. Refine o filtro em vez de carregar tudo.`,
      );
    }
  }
}
