import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * rtc-webhook — recebe da Receita Federal o retorno da solicitação de apuração.
 *
 * Fluxo da Receita (3 passos): token -> solicitação com urlRetorno -> a Receita
 * CHAMA esta função entregando { tiqueteSolicitacao, tiqueteDownload } -> download.
 *
 * Este endereço é PÚBLICO por necessidade — quem chama é a Receita, não um usuário
 * autenticado nosso. Por isso a autenticação é por SEGREDO NA URL (?ref=...),
 * gerado por solicitação e de uso único: depois de aceito, o segredo é apagado.
 *
 * Postura defensiva deliberada: qualquer chamada inválida recebe 200 com corpo
 * vazio. Não confirmamos se o segredo existe, se já foi usado ou se expirou —
 * quem estiver sondando não aprende nada. E responder 200 evita que a Receita
 * fique reenviando por causa de erro que não é dela.
 *
 * Código copiado da versão 13 publicada no Supabase (27/11/2026), que não estava
 * versionada no repositório. Publicada com verify_jwt = false.
 */
Deno.serve(async (req: Request) => {
  const opaco = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return opaco();

  try {
    const url = new URL(req.url);
    const ref = url.searchParams.get("ref") ?? "";
    // 24 bytes em hex = 48 caracteres. Formato errado nem chega ao banco.
    if (!/^[a-f0-9]{48}$/.test(ref)) return opaco();

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") return opaco();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // A validação de verdade (existe? está aguardando? expirou?) mora no banco,
    // dentro de uma transação com FOR UPDATE — não aqui.
    const { error } = await db.rpc("rtc_apuracao_receber_tiquete", {
      p_ref: ref,
      p_payload: payload,
    });

    if (error) console.error("[rtc-webhook] falha ao registrar tiquete", error.message);
    return opaco();
  } catch (e) {
    // Nunca vaza detalhe de erro para fora: só para o nosso log.
    console.error("[rtc-webhook] erro inesperado", e instanceof Error ? e.message : String(e));
    return opaco();
  }
});
