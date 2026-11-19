/**
 * Consulta Optantes do Portal do Simples Nacional (opção pelo regime regular de
 * IBS e CBS). A página é protegida por hCaptcha e não tem lote nem API: a
 * consulta é feita por uma pessoa. O app só lê o texto do resultado (colado ou
 * enviado pela extensão do navegador) e grava pela RPC da migration 0254.
 *
 * Formato do resultado (print de 18/11/2026):
 *   Data da consulta: 18/11/2026 21:50:04
 *   CNPJ: 69.699.530/0001-76
 *   Nome Empresarial: KYNDO TECNOLOGIA E INOVACAO LTDA
 *   Situação no Simples Nacional: Optante pelo Simples Nacional desde 20/10/2026
 *   Situação no Regime Regular do IBS: Não optante
 *   Situação no Regime Regular da CBS: Não optante
 */
import { supabase } from "@/integrations/supabase/client";

import { isValidCnpj, stripCnpj } from "./cnpj";
import { taxFrom, taxRpc } from "./import-client";
import type { PortfolioRow } from "./portfolio";

export const CONSULTA_OPTANTES_URL = "https://consopt.www8.receita.fazenda.gov.br/consultaoptantes";

export type Opcao = { valor: "sim" | "nao"; desde: string | null; texto: string };

export type ConsultaOptantes = {
  cnpj: string;
  /** ISO com fuso de Brasília. */
  consultadoEm: string;
  nome: string | null;
  simples: string | null;
  ibs: Opcao;
  cbs: Opcao;
};

export type ParseResult = { ok: true; value: ConsultaOptantes } | { ok: false; erro: string };

const norm = (s: string) =>
  s
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "");

const brDate = (d: string) => {
  const [dd, mm, yyyy] = d.split("/");
  return `${yyyy}-${mm}-${dd}`;
};

function campo(text: string, rotulo: RegExp): string | null {
  const m = rotulo.exec(text);
  return m ? m[1]!.trim() : null;
}

function opcao(v: string | null): Opcao | null {
  if (!v) return null;
  const t = v.trim();
  const desde = /desde\s+(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1];
  if (/^n[ãa]o\b/i.test(t)) return { valor: "nao", desde: null, texto: t };
  if (/^optante\b/i.test(t)) return { valor: "sim", desde: desde ? brDate(desde) : null, texto: t };
  return null;
}

export function parseConsultaOptantes(raw: string): ParseResult {
  const text = norm(raw ?? "");
  if (/impedido por prote[çc][ãa]o captcha/i.test(text))
    return {
      ok: false,
      erro: "A Receita pediu o captcha. Resolva na página da Receita e consulte de novo.",
    };
  if (/informe um cnpj v[áa]lido/i.test(text))
    return { ok: false, erro: "A Receita não aceitou o CNPJ informado." };

  const data = /Data da consulta:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/i.exec(text);
  const cnpj = stripCnpj(campo(text, /CNPJ:\s*([0-9A-Z./-]{14,18})/i));
  const ibs = opcao(campo(text, /Regime Regular do IBS:\s*([^\n]+)/i));
  const cbs = opcao(campo(text, /Regime Regular da CBS:\s*([^\n]+)/i));
  if (!data || !cnpj || !isValidCnpj(cnpj))
    return {
      ok: false,
      erro: "Não encontrei a data da consulta e o CNPJ no texto. Copie a página inteira do resultado (Ctrl+A, Ctrl+C).",
    };
  if (!ibs || !cbs)
    return {
      ok: false,
      erro: "Não reconheci a situação no regime regular do IBS e da CBS no texto copiado.",
    };
  const hora = data[2]!.length === 5 ? `${data[2]}:00` : data[2]!;
  return {
    ok: true,
    value: {
      cnpj,
      consultadoEm: `${brDate(data[1]!)}T${hora}-03:00`,
      nome: campo(text, /Nome Empresarial:\s*([^\n]+)/i),
      simples: campo(text, /Situa[çc][ãa]o no Simples Nacional:\s*([^\n]+)/i),
      ibs,
      cbs,
    },
  };
}

/** Raiz de 8 caracteres: a opção abrange todos os estabelecimentos da empresa. */
export const raizOf = (cnpj: string) => cnpj.slice(0, 8);

export type ConsultaRegistrada = {
  raiz: string;
  /** consulta_assistida = feita por pessoa no app; cnpja_simples = API da CNPJá (0255). */
  fonte?: "consulta_assistida" | "cnpja_simples";
  ibs: "sim" | "nao";
  cbs: "sim" | "nao";
  ibsDesde: string;
  cbsDesde: string;
  consultadoEm: string;
  descricao: string;
  temArquivo: boolean;
};

/** Consultas ativas do tenant, por raiz (evidências ibs_regular e cbs_regular). */
export async function loadConsultas(tenantId: string): Promise<Map<string, ConsultaRegistrada>> {
  const out = new Map<string, ConsultaRegistrada>();
  const size = 1000;
  type Ev = {
    lookup_key: string;
    fact: "ibs_regular" | "cbs_regular";
    asserted_value: "sim" | "nao";
    valid_from: string;
    document_date: string;
    origin_description: string;
    file_path: string | null;
    created_at: string;
  };
  for (let page = 0; ; page++) {
    const { data, error } = await taxFrom("tax_evidences")
      .select(
        "lookup_key, fact, asserted_value, valid_from, document_date, origin_description, file_path, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("origin", "portal_simples_nacional")
      .eq("granularity", "raiz")
      .eq("status", "ativa")
      .in("fact", ["ibs_regular", "cbs_regular"])
      .order("lookup_key")
      .order("fact")
      .range(page * size, page * size + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Ev[];
    for (const e of rows) {
      const cur =
        out.get(e.lookup_key) ??
        ({
          raiz: e.lookup_key,
          fonte: "consulta_assistida",
          ibs: "nao",
          cbs: "nao",
          ibsDesde: e.valid_from,
          cbsDesde: e.valid_from,
          consultadoEm: e.document_date,
          descricao: e.origin_description,
          temArquivo: !!e.file_path,
        } satisfies ConsultaRegistrada);
      if (e.fact === "ibs_regular") {
        cur.ibs = e.asserted_value;
        cur.ibsDesde = e.valid_from;
      } else {
        cur.cbs = e.asserted_value;
        cur.cbsDesde = e.valid_from;
      }
      out.set(e.lookup_key, cur);
    }
    if (rows.length < size) break;
  }
  return out;
}

const EVIDENCE_BUCKET = "tax-evidences";
const MIMES = ["application/pdf", "image/png", "image/jpeg"];

async function sha256(file: Blob) {
  const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Grava a consulta (e o print, se houver) como evidência do tenant. */
export async function registrarConsulta(
  tenantId: string,
  cnpjDaLinha: string,
  c: ConsultaOptantes,
  arquivo?: File | null,
) {
  if (raizOf(c.cnpj) !== raizOf(cnpjDaLinha))
    throw new Error("O resultado copiado é de outra empresa. Consulte o CNPJ desta linha.");
  let file: { path: string; sha: string; mime: string; size: number } | null = null;
  if (arquivo) {
    if (!MIMES.includes(arquivo.type)) throw new Error("Anexe PDF, PNG ou JPEG.");
    if (arquivo.size > 20 * 1024 * 1024) throw new Error("Arquivo acima de 20 MB.");
    const sha = await sha256(arquivo);
    const ext =
      arquivo.type === "application/pdf" ? "pdf" : arquivo.type === "image/png" ? "png" : "jpg";
    const path = `${tenantId}/consulta-optantes/${raizOf(c.cnpj)}/${sha}.${ext}`;
    const { error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, arquivo, { contentType: arquivo.type, upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(error.message);
    file = { path, sha, mime: arquivo.type, size: arquivo.size };
  }
  const { data, error } = await taxRpc("tax_register_consulta_optantes", {
    p_tenant: tenantId,
    p_cnpj: cnpjDaLinha,
    p_ibs: c.ibs.valor,
    p_ibs_desde: c.ibs.desde,
    p_cbs: c.cbs.valor,
    p_cbs_desde: c.cbs.desde,
    p_consultado_em: c.consultadoEm,
    p_file_path: file?.path ?? null,
    p_file_sha256: file?.sha ?? null,
    p_file_mime: file?.mime ?? null,
    p_file_size: file?.size ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { raiz: string };
}

/** Opção gravada pela carga da CNPJá no cadastro público (tax_entities, 0255). */
export function consultaDaBase(r: PortfolioRow): ConsultaRegistrada | null {
  const e = r.tax_entities;
  if (!e.ibs_cbs_fonte || !e.ibs_cbs_consultado_em) return null;
  if (
    (e.ibs_regular !== "sim" && e.ibs_regular !== "nao") ||
    (e.cbs_regular !== "sim" && e.cbs_regular !== "nao")
  )
    return null;
  const dia = e.ibs_cbs_consultado_em.slice(0, 10);
  return {
    raiz: raizOf(r.cnpj),
    fonte: "cnpja_simples",
    ibs: e.ibs_regular,
    cbs: e.cbs_regular,
    ibsDesde: e.ibs_desde ?? dia,
    cbsDesde: e.cbs_desde ?? dia,
    consultadoEm: dia,
    descricao: "CNPJá (fonte: Consulta Optantes do Portal do Simples)",
    temArquivo: false,
  };
}

/** A mais recente entre a consulta assistida do tenant e a da CNPJá. */
export function consultaEfetiva(
  r: PortfolioRow,
  assistida: ConsultaRegistrada | null | undefined,
): ConsultaRegistrada | null {
  const base = consultaDaBase(r);
  if (!assistida) return base;
  if (!base) return assistida;
  return assistida.consultadoEm >= base.consultadoEm ? assistida : base;
}

/** Texto curto para a grade e o Excel. */
export function ibsCbsText(c: ConsultaRegistrada | null | undefined): string {
  if (!c) return "A confirmar";
  const dia = c.consultadoEm.slice(0, 10).split("-").reverse().join("/");
  const origem = c.fonte === "cnpja_simples" ? `CNPJá, ${dia}` : `consulta de ${dia}`;
  const parte = (v: "sim" | "nao", desde: string) =>
    v === "sim" ? `optante desde ${desde.split("-").reverse().join("/")}` : "não optante";
  if (c.ibs === c.cbs && c.ibsDesde === c.cbsDesde)
    return `IBS e CBS: ${parte(c.ibs, c.ibsDesde)} (${origem})`;
  return `IBS: ${parte(c.ibs, c.ibsDesde)}; CBS: ${parte(c.cbs, c.cbsDesde)} (${origem})`;
}
