/**
 * GERAÇÃO DE DARF DA CBS (API v2 da Receita, documentação 1.0 de 13/11/2026).
 *
 *   PCONT  pagamento pela própria empresa, por período de apuração.
 *   RAD    recolhimento como ADQUIRENTE, nota a nota do fornecedor.
 *
 * As duas são síncronas: um POST, e a resposta já traz PIX, código de barras,
 * link do PDF, vencimento e valores. Não há tíquete nem webhook.
 *
 * Gerar DARF cria documento oficial de arrecadação. Por isso:
 *   - só dono, finanças e administradores (rtc_pode_emitir_darf, 0260);
 *   - cada pedido e cada resposta — inclusive as recusas — ficam em
 *     `rtc_cbs_darf`, com quem pediu, e na auditoria;
 *   - o valor é o que a Receita devolveu. Nada é calculado aqui.
 */

import {
  ApuracaoGatewayError,
  accessToken,
  ambienteAtual,
  baseObrigatoria,
  corpoJson,
  loadApiKey,
  logUse,
  rpc,
  table,
  transporte,
  withTimeout,
  type AdminClient,
} from "@/lib/rtc-apuracao.server";
import {
  lerRespostaDarf,
  pedidoPcont,
  pedidoRad,
  type ItemRad,
  type OpcaoPagamento,
  type ResultadoDarf,
} from "@/lib/rtc-v2/darf";
import { urlDarf, type TipoDarf } from "@/lib/rtc-v2/enderecos";

export type DarfGerado = {
  id: string | null;
  tipo: TipoDarf;
  pa: string | null;
  chaveDFE: string | null;
  resultado: ResultadoDarf;
};

export type GerarDarfResult =
  | { ok: true; darfs: DarfGerado[] }
  | { ok: false; motivo: string };

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function cnpjDoTenant(a: AdminClient, tenantId: string): Promise<string> {
  const { data } = await table(a, "tenants").select("cnpj").eq("id", tenantId).maybeSingle();
  const cnpj = String(data?.cnpj ?? "").replace(/[^0-9A-Za-z]/g, "");
  if (cnpj.length !== 14) {
    throw new ApuracaoGatewayError("not_configured", "A empresa não tem um CNPJ completo cadastrado.");
  }
  return cnpj;
}

async function postDarf(
  tipo: TipoDarf,
  cnpj: string,
  corpo: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const url = urlDarf(baseObrigatoria(), ambienteAtual(), tipo, cnpj);
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(corpo),
        signal,
      }),
    );
  } catch (error) {
    throw transporte(error, `darf_${tipo}`);
  }
  const text = await res.text();
  let body: unknown = corpoJson(text);
  if (body === null) {
    try {
      body = text ? JSON.parse(text) : null; // pode ser uma lista (RAD)
    } catch {
      body = null;
    }
  }
  // 400/404 com `cdRetorno` é resposta de negócio (ex.: DFE_NAO_ENCONTRADO),
  // não falha de transporte: vira registro com o código. Sem corpo legível,
  // aí sim é erro.
  if (!body) {
    throw new ApuracaoGatewayError(
      "error",
      `A Receita respondeu à geração do DARF sem conteúdo legível (HTTP ${res.status}).`,
      res.status,
    );
  }
  return { status: res.status, body };
}

async function registrar(
  a: AdminClient,
  tenantId: string,
  usuario: string,
  base: {
    tipo: TipoDarf;
    pa: string | null;
    chaveDFE: string | null;
    opcao: OpcaoPagamento;
    valorParcialCents: number | null;
    pedido: unknown;
    status: number;
  },
  r: ResultadoDarf,
): Promise<string | null> {
  const { data, error } = await rpc(a)("rtc_cbs_darf_registrar", {
    p_tenant: tenantId,
    p_usuario: usuario,
    p_registro: {
      tipo: base.tipo,
      pa: base.pa,
      chave_dfe: r.chaveDFE ?? base.chaveDFE,
      opcao_pagamento: base.opcao,
      valor_parcial_cents: base.valorParcialCents,
      pedido: base.pedido,
      http_status: base.status,
      cd_retorno: r.cdRetorno,
      gerado: r.gerado,
      chave_pix: r.chavePix,
      codigo_barras: r.codigoBarras,
      link_pdf: r.linkPdf,
      data_maxima: r.dataMaxima,
      principal_cents: r.principalCents,
      multa_cents: r.multaCents,
      juros_cents: r.jurosCents,
      total_cents: r.totalCents,
      mensagem: r.mensagem,
      dados_invalidos: r.dadosInvalidos,
    },
  });
  if (error) {
    // O DARF pode ter sido gerado na Receita: não esconder do usuário. Volta o
    // resultado mesmo assim, sem id, e o console guarda o motivo.
    console.error("[rtc-darf] DARF não registrado no banco", { erro: error.message, cd: r.cdRetorno });
    return null;
  }
  return (data as string | null) ?? null;
}

export async function gerarDarfPcont(
  tenantId: string,
  usuario: string,
  input: { pa: string; opcao: OpcaoPagamento; valorParcialCents?: number | null },
): Promise<GerarDarfResult> {
  let pedido: ReturnType<typeof pedidoPcont>;
  try {
    pedido = pedidoPcont(input);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
  return executar(tenantId, usuario, "pcont", pedido, [
    { pa: pedido.pa, chaveDFE: null, opcao: input.opcao, valorParcialCents: input.valorParcialCents ?? null },
  ]);
}

export async function gerarDarfRad(tenantId: string, usuario: string, itens: ItemRad[]): Promise<GerarDarfResult> {
  let pedido: ReturnType<typeof pedidoRad>;
  try {
    pedido = pedidoRad(itens);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
  return executar(
    tenantId,
    usuario,
    "rad",
    pedido,
    pedido.map((p, i) => ({
      pa: null,
      chaveDFE: p.chaveDFE,
      opcao: p.opcaoPagamento,
      valorParcialCents: itens[i]?.opcao === "PAGAMENTO_PARCIAL" ? (itens[i]?.valorParcialCents ?? null) : null,
    })),
  );
}

async function executar(
  tenantId: string,
  usuario: string,
  tipo: TipoDarf,
  pedido: unknown,
  itens: Array<{ pa: string | null; chaveDFE: string | null; opcao: OpcaoPagamento; valorParcialCents: number | null }>,
): Promise<GerarDarfResult> {
  const a = await admin();
  let credentialId: string | null = null;
  try {
    const cnpj = await cnpjDoTenant(a, tenantId);
    const credential = await loadApiKey(a, tenantId);
    credentialId = credential.id;
    const { token } = await accessToken(credential.apiKey);
    const { status, body } = await postDarf(tipo, cnpj, pedido, token);
    const resultados = lerRespostaDarf(body);
    await logUse(a, credential.id, `darf.${tipo}`, resultados.some((r) => r.gerado), `http=${status}`);

    const darfs: DarfGerado[] = [];
    for (let i = 0; i < resultados.length; i++) {
      const r = resultados[i] as ResultadoDarf;
      // Resposta única para um pedido de várias notas: o registro aponta a
      // primeira e o pedido inteiro fica guardado em `pedido`.
      const item = itens[Math.min(i, itens.length - 1)] ?? itens[0];
      const id = await registrar(
        a,
        tenantId,
        usuario,
        {
          tipo,
          pa: item?.pa ?? null,
          chaveDFE: resultados.length === itens.length ? (item?.chaveDFE ?? null) : null,
          opcao: item?.opcao ?? "PAGAMENTO_TOTAL",
          valorParcialCents: item?.valorParcialCents ?? null,
          pedido,
          status,
        },
        r,
      );
      darfs.push({ id, tipo, pa: item?.pa ?? null, chaveDFE: r.chaveDFE ?? item?.chaveDFE ?? null, resultado: r });
    }
    return { ok: true, darfs };
  } catch (e) {
    const err = e as ApuracaoGatewayError;
    if (credentialId) await logUse(a, credentialId, `darf.${tipo}`, false, err.message);
    return { ok: false, motivo: err.message };
  }
}

/**
 * PDF do DARF. A documentação dá `linkDarfPDF` sem dizer se o link exige o
 * Bearer. Tentamos primeiro com ele (é o mesmo domínio da API); só seguimos
 * links da própria Receita, para este servidor não virar um baixador de
 * endereços arbitrários.
 */
export async function baixarPdfDarf(
  tenantId: string,
  darfId: string,
): Promise<{ ok: true; base64: string; nome: string } | { ok: false; motivo: string }> {
  const a = await admin();
  const { data } = await table(a, "rtc_cbs_darf")
    .select("id, tenant_id, link_pdf, tipo, pa, criado_em")
    .eq("id", darfId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data?.link_pdf) return { ok: false, motivo: "Este DARF não tem link de PDF." };
  let link: URL;
  try {
    link = new URL(String(data.link_pdf));
  } catch {
    return { ok: false, motivo: "O link do PDF devolvido pela Receita é inválido." };
  }
  const permitido = link.protocol === "https:" && /(^|\.)receitafederal\.gov\.br$|(^|\.)serpro\.gov\.br$/.test(link.hostname);
  if (!permitido) return { ok: false, motivo: "O link do PDF não é de um domínio da Receita." };

  try {
    const credential = await loadApiKey(a, tenantId);
    const { token } = await accessToken(credential.apiKey);
    const res = await withTimeout((signal) =>
      fetch(link.toString(), { headers: { Authorization: `Bearer ${token}` }, signal }),
    );
    if (!res.ok) return { ok: false, motivo: `A Receita recusou o download do PDF (HTTP ${res.status}).` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 5_000_000) return { ok: false, motivo: "PDF maior que o esperado." };
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    const nome = `DARF-CBS-${String(data.tipo).toUpperCase()}-${String(data.pa ?? "").replace("/", "-") || String(data.id).slice(0, 8)}.pdf`;
    return { ok: true, base64: btoa(bin), nome };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}
