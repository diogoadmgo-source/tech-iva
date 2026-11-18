// Layouts dos arquivos públicos da Receita usados pelo motor.
//
// Dados Abertos do CNPJ: sem cabeçalho, ";" e aspas, ISO-8859-1. Colunas
// conforme o documento "CNPJ - Metadados" da Receita. A conferência é feita nas
// primeiras linhas de cada arquivo: se o número de colunas ou o formato da
// chave não bater, a execução para com status "abortada_layout" em vez de gravar
// dado mal interpretado.
//
// Regime tributário (ECF): os nomes das colunas são lidos do cabeçalho. Se as
// colunas esperadas não estiverem lá, a execução também para.

export const SITUACAO = { "01": "NULA", "1": "NULA", "02": "ATIVA", "2": "ATIVA", "03": "SUSPENSA", "3": "SUSPENSA",
  "04": "INAPTA", "4": "INAPTA", "08": "BAIXADA", "8": "BAIXADA" };

const RAIZ = /^[0-9A-Z]{8}$/;

/** AAAAMMDD → AAAA-MM-DD; vazio ou zeros → null; fora do formato → undefined (erro). */
export function receitaDate(v) {
  const s = (v ?? "").trim();
  if (s === "" || /^0+$/.test(s)) return null;
  if (!/^\d{8}$/.test(s)) return undefined;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const sn = (v) => {
  const s = (v ?? "").trim().toUpperCase();
  return s === "S" || s === "N" ? s : s === "" ? "" : undefined;
};

export const DATASETS = {
  receita_simples: {
    granularity: "raiz",
    files: /^simples.*\.zip$/i,
    columns: 7,
    keyOf: (f) => f[0],
    normalize(f) {
      const n = {
        opcao_simples: sn(f[1]),
        data_opcao_simples: receitaDate(f[2]),
        data_exclusao_simples: receitaDate(f[3]),
        opcao_mei: sn(f[4]),
        data_opcao_mei: receitaDate(f[5]),
        data_exclusao_mei: receitaDate(f[6]),
      };
      return Object.values(n).some((v) => v === undefined) ? null : n;
    },
    raw: (f) => ({ cnpj_basico: f[0], opcao_simples: f[1], data_opcao_simples: f[2], data_exclusao_simples: f[3],
      opcao_mei: f[4], data_opcao_mei: f[5], data_exclusao_mei: f[6] }),
  },
  receita_empresas: {
    granularity: "raiz",
    files: /^empresas\d*\.zip$/i,
    columns: 7,
    keyOf: (f) => f[0],
    normalize: (f, ctx) => ({ razao_social: f[1].trim(), natureza_juridica: f[2].trim(),
      natureza_descricao: ctx?.naturezas?.get(f[2].trim()) ?? "", porte: f[5].trim() }),
    raw: (f) => ({ cnpj_basico: f[0], razao_social: f[1], natureza_juridica: f[2], qualificacao_responsavel: f[3],
      capital_social: f[4], porte: f[5], ente_federativo: f[6] }),
  },
  receita_estabelecimentos: {
    granularity: "estabelecimento",
    files: /^estabelecimentos\d*\.zip$/i,
    columns: 30,
    keyOf: (f) => `${f[0]}${f[1]}${f[2]}`,
    normalize(f, ctx) {
      const data = receitaDate(f[6]);
      if (data === undefined) return null;
      return {
        nome_fantasia: f[4].trim(),
        situacao_cadastral: SITUACAO[f[5].trim()] ?? `CÓDIGO ${f[5].trim()}`,
        situacao_data: data,
        uf: f[19].trim(),
        municipio: ctx.municipios?.get(f[20].trim()) ?? "",
        municipio_codigo_rfb: f[20].trim(),
        // Data de abertura fora do formato não descarta a linha: fica vazia.
        data_abertura: receitaDate(f[10]) ?? null,
        cnae_principal: f[11].trim(),
        cnae_descricao: ctx.cnaes?.get(f[11].trim()) ?? "",
      };
    },
    // Só o que a classificação e a tela usam; endereço, telefone e e-mail ficam de fora.
    raw: (f) => ({ cnpj_basico: f[0], cnpj_ordem: f[1], cnpj_dv: f[2], identificador_matriz_filial: f[3],
      nome_fantasia: f[4], situacao_cadastral: f[5], data_situacao_cadastral: f[6], motivo_situacao_cadastral: f[7],
      data_inicio_atividade: f[10], cnae_fiscal_principal: f[11], uf: f[19], municipio: f[20] }),
  },
};

/** Colunas do regime tributário (ECF), por nome normalizado do cabeçalho. */
export const REGIME_COLUMNS = {
  ano: ["ano", "ano_calendario", "ano calendario"],
  cnpj: ["cnpj"],
  cnpj_da_scp: ["cnpj_da_scp", "cnpj da scp", "cnpj_scp"],
  forma: ["forma_de_tributacao", "forma de tributacao", "forma_tributacao", "forma de tributação"],
  quantidade: ["quantidade_de_escrituracoes", "quantidade de escrituracoes", "qtde_escrituracoes"],
};

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Mapeia o cabeçalho; devolve { idx } ou { erro }. */
export function regimeHeader(fields) {
  const names = fields.map(norm);
  const idx = {};
  for (const [k, alts] of Object.entries(REGIME_COLUMNS)) {
    const i = names.findIndex((n) => alts.includes(n));
    if (i >= 0) idx[k] = i;
  }
  const faltam = ["ano", "cnpj", "forma"].filter((k) => idx[k] === undefined);
  return faltam.length ? { erro: `colunas ausentes: ${faltam.join(", ")}` } : { idx };
}

export const isRaiz = (k) => RAIZ.test(k);
