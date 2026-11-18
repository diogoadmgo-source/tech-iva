// Edge Function tax-intel-processar — botão "Processar agora" da Base de CNPJs.
//
// Fluxo: valida o usuário pelo JWT → tax_request_processing (permissão,
// anti-repetição, auditoria) → aciona o workflow do motor no GitHub →
// tax_mark_processing_request (enviado/falhou). Sem service_role: tudo roda com
// o JWT de quem clicou. O único segredo é GITHUB_DISPATCH_TOKEN (token
// fine-grained só com "Actions: read and write" no repositório tech-iva).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const REPO = Deno.env.get("TAX_INTEL_REPO") ?? "diogoadmgo-source/tech-iva";
const WORKFLOW = "tax-intel-motor.yml";
const REF = Deno.env.get("TAX_INTEL_REF") ?? "main";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, motivo: "metodo" });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, motivo: "nao_autenticado" });

  let tenantId: unknown;
  try {
    ({ tenantId } = await req.json());
  } catch {
    return json(400, { ok: false, motivo: "corpo_invalido" });
  }
  if (typeof tenantId !== "string" || !UUID.test(tenantId)) {
    return json(400, { ok: false, motivo: "empresa_invalida" });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: pedido, error } = await db.rpc("tax_request_processing", { p_tenant: tenantId });
  if (error) {
    const proibido = error.code === "42501";
    return json(proibido ? 403 : 500, { ok: false, motivo: proibido ? "sem_permissao" : "erro_banco", detalhe: error.message });
  }
  if (!pedido?.ok) return json(409, pedido);

  const token = Deno.env.get("GITHUB_DISPATCH_TOKEN");
  const marcar = (status: "enviado" | "falhou", erro?: string) =>
    db.rpc("tax_mark_processing_request", { p_request: pedido.request_id, p_status: status, p_error: erro ?? null });

  if (!token) {
    await marcar("falhou", "processamento pelo app ainda não configurado (GITHUB_DISPATCH_TOKEN)");
    return json(503, { ok: false, motivo: "nao_configurado" });
  }

  let resp: Response;
  try {
    resp = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "teckiva-tax-intel",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: REF, inputs: { modo: "carga" } }),
    });
  } catch (e) {
    await marcar("falhou", `GitHub inacessível: ${(e as Error).message}`);
    return json(502, { ok: false, motivo: "github_inacessivel" });
  }

  if (resp.status !== 204) {
    const corpo = (await resp.text()).slice(0, 300);
    await marcar("falhou", `GitHub respondeu ${resp.status}: ${corpo}`);
    return json(502, { ok: false, motivo: "github_recusou", status: resp.status });
  }

  await marcar("enviado");
  return json(200, { ok: true, request_id: pedido.request_id });
});
