import { createFileRoute } from "@tanstack/react-router";

import { lerCorpoRetorno, metaDaRequisicao, TAMANHO_MAXIMO_RETORNO } from "@/lib/rtc-v2/corpo-retorno";
import { refValido } from "@/lib/rtc-v2/refvalido";

/**
 * Webhook de retorno da apuração de débitos da CBS (RTC / Receita Federal).
 *
 * A Receita não assina o callback: a autenticação é a própria URL. O
 * `rtc_apuracao_solicitar` gera um `webhook_ref` de 24 bytes aleatórios por
 * solicitação, e é ele que vai no campo `urlRetorno` da chamada:
 *
 *   POST https://<host>/api/public/rtc/apuracao/<webhook_ref>
 *
 * O ref é de uso único e só é aceito por 24 horas (regras dentro da RPC
 * `rtc_apuracao_receber_tiquete`, migração 0235). TODA chamada fica registrada
 * em `rtc_webhook_recebido`, aceita ou não. Depois de gravado o comprovante de
 * download, só o botão "Reprocessar retorno" baixa — nada roda sozinho.
 */
export const Route = createFileRoute("/api/public/rtc/apuracao/$ref")({
  server: {
    handlers: {
      HEAD: async ({ params }) => {
        /*
         * A Receita valida a urlRetorno com HEAD antes de processar; se não
         * responder, "a solicitação é cancelada com erro" e a chamada do dia
         * é gasta à toa. Responde só pelo FORMATO da referência, sem tocar o
         * banco: assim não revela se uma referência existe, e não fica de pé
         * um caminho de varredura.
         */
        const ref = (params as { ref?: string }).ref ?? "";
        return new Response(null, { status: refValido(ref) ? 200 : 404 });
      },
      POST: async ({ request, params }) => {
        const ref = (params as { ref?: string }).ref ?? "";
        // formato fixo: 24 bytes em hex. Barra qualquer varredura antes do banco.
        if (!refValido(ref)) {
          return new Response("Referência inválida", { status: 404 });
        }

        /*
         * Duas regras de 26/09/2026 (ver src/lib/rtc-v2/corpo-retorno.ts):
         * nada se perde — até formato inesperado é gravado para análise, porque
         * ainda não sabemos como é o retorno real da v1 —, e com teto de tamanho,
         * porque este endereço é público.
         */
        const declarado = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO_RETORNO) {
          return new Response("Corpo grande demais", { status: 413 });
        }
        const bruto = await request.text();
        const corpo = lerCorpoRetorno(bruto);
        if (corpo.tipo === "grande_demais") {
          return new Response("Corpo grande demais", { status: 413 });
        }
        const meta = {
          ...metaDaRequisicao(request.headers, new TextEncoder().encode(bruto).length),
          // Formato inesperado: só registra, sem casar com a solicitação — para
          // um corpo que não entendemos não consumir o endereço de retorno.
          ...(corpo.tipo === "nao_objeto" ? { somente_registrar: true } : {}),
        };

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await (
          supabaseAdmin.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message: string } | null }>
        )("rtc_apuracao_receber_tiquete", { p_ref: ref, p_payload: corpo.payload, p_meta: meta });

        if (error) {
          console.error("[rtc-webhook] falha ao gravar tíquete:", error.message);
          // 500 faz a Receita reenviar; erro nosso merece nova tentativa.
          return new Response("Erro ao registrar o tíquete", { status: 500 });
        }

        if (corpo.tipo === "nao_objeto") {
          console.warn("[rtc-webhook] corpo fora do formato esperado, registrado para análise", {
            motivo: corpo.payload._motivo,
          });
          return new Response("Corpo não é um objeto JSON", { status: 400 });
        }

        const result = data as { ok?: boolean; id?: string; erro?: string } | null;
        if (result?.erro) {
          // Falhou ao processar, mas a chamada ficou registrada. 500 pede à
          // Receita que reenvie.
          console.error("[rtc-webhook] erro ao processar retorno:", result.erro);
          return new Response("Erro ao registrar o tíquete", { status: 500 });
        }
        if (!result?.ok || !result.id) {
          // ref desconhecido, expirado ou já consumido: não reenviar.
          return new Response("Solicitação não encontrada", { status: 404 });
        }

        /*
         * PASSO 3 no próprio aplicativo: baixa o JSON com o tíquete e chama a
         * ingestão. Não depende de worker externo. A Receita não precisa esperar
         * o resultado disso — respondemos 200 de qualquer forma, e a falha fica
         * registrada na apuração (status 'erro') para reprocessamento.
         */
        const { processarApuracao } = await import("@/lib/rtc-apuracao.server");
        try {
          await processarApuracao(result.id);
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
