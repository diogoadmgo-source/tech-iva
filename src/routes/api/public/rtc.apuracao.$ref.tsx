import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook de retorno da apuração de débitos da CBS (RTC / Receita Federal).
 *
 * A Receita não assina o callback: a autenticação é a própria URL. O
 * `rtc_apuracao_solicitar` gera um `webhook_ref` de 24 bytes aleatórios por
 * solicitação, e é ele que vai no campo `urlRetorno` da chamada:
 *
 *   POST https://<host>/api/public/rtc/apuracao/<webhook_ref>
 *
 * O ref é de uso único e só é aceito por 2 horas (regras dentro da RPC
 * `rtc_apuracao_receber_tiquete`). Depois de gravado o `tiqueteDownload`, a
 * linha entra em `rtc_apuracao_pendentes_download()` e o worker baixa o JSON.
 */
export const Route = createFileRoute("/api/public/rtc/apuracao/$ref")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ref = (params as { ref?: string }).ref ?? "";
        // formato fixo: 24 bytes em hex. Barra qualquer varredura antes do banco.
        if (!/^[0-9a-f]{48}$/.test(ref)) {
          return new Response("Referência inválida", { status: 404 });
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response("Corpo não é JSON", { status: 400 });
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return new Response("Corpo não é um objeto JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await (
          supabaseAdmin.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message: string } | null }>
        )("rtc_apuracao_receber_tiquete", { p_ref: ref, p_payload: payload });

        if (error) {
          console.error("[rtc-webhook] falha ao gravar tíquete:", error.message);
          // 500 faz a Receita reenviar; erro nosso merece nova tentativa.
          return new Response("Erro ao registrar o tíquete", { status: 500 });
        }

        const result = data as { ok?: boolean; id?: string } | null;
        if (!result?.ok) {
          // ref desconhecido, expirado ou já consumido: não reenviar.
          return new Response("Solicitação não encontrada", { status: 404 });
        }

        /*
         * PASSO 3 no próprio aplicativo: baixa o JSON com o tíquete e chama a
         * ingestão. Não depende de worker externo. A Receita não precisa esperar
         * o resultado disso — respondemos 200 de qualquer forma, e a falha fica
         * registrada na apuração (status 'erro') para reprocessamento.
         */
        const { processarPendentes } = await import("@/lib/rtc-apuracao.server");
        try {
          await processarPendentes();
        } catch (e) {
          console.error(
            "[rtc-webhook] tíquete gravado, mas o download falhou:",
            e instanceof Error ? e.message : e,
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});
