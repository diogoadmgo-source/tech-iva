import { createFileRoute } from "@tanstack/react-router";

import { renderDigestEmail, type DigestPayload } from "@/lib/email/digest-template";
import { sendEmail } from "@/lib/email/resend.server";

/**
 * Bloco 3.10 — envio do resumo semanal.
 * Chamado por agendador externo (pg_cron/scheduler) com o header x-cron-secret.
 * Sem o segredo configurado, o endpoint não executa nada.
 */
export const Route = createFileRoute("/api/public/cron/weekly-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        if (!secret) return new Response("CRON_SECRET não configurado", { status: 503 });
        if (request.headers.get("x-cron-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const weekdayParam = url.searchParams.get("weekday");
        const weekday = weekdayParam ? Number(weekdayParam) : new Date().getUTCDay();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("weekly_digest_batch", {
          p_weekday: weekday,
        });
        if (error) return new Response(`Erro ao montar resumos: ${error.message}`, { status: 500 });

        const appUrl = process.env["APP_URL"] ?? url.origin;
        const payloads = ((data ?? []) as unknown as DigestPayload[]).filter(
          (p) => Array.isArray(p.recipients) && p.recipients.length > 0,
        );

        let sent = 0;
        const failures: string[] = [];
        for (const payload of payloads) {
          const { subject, html } = renderDigestEmail(payload, appUrl);
          for (const to of payload.recipients) {
            try {
              await sendEmail({ to, subject, html });
              sent += 1;
            } catch (err) {
              failures.push(`${payload.tenant_name}/${to}: ${(err as Error).message}`);
            }
          }
        }

        return Response.json({ weekday, tenants: payloads.length, sent, failures });
      },
    },
  },
});
