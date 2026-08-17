/**
 * Envio de e-mail via Resend através do gateway de conectores da Lovable.
 * Server-only: usa LOVABLE_API_KEY + RESEND_API_KEY.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<{ id: string }> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  if (!lovableKey) throw new Error("LOVABLE_API_KEY não configurada.");
  if (!resendKey) throw new Error("RESEND_API_KEY não configurada.");

  const from = process.env["EMAIL_FROM"] ?? "TECH-IVA <nao-responda@techiva.com.br>";

  const response = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[email] falha no envio [${response.status}]: ${body}`);
    throw new Error(`Falha ao enviar e-mail [${response.status}]: ${body}`);
  }

  const data = (await response.json()) as { id?: string };
  return { id: data.id ?? "" };
}
