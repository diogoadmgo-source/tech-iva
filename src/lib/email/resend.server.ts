/**
 * Envio de e-mail pela API do Resend.
 * Server-only: usa RESEND_API_KEY.
 */

const API_URL = "https://api.resend.com";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<{ id: string }> {
  const resendKey = process.env["RESEND_API_KEY"];
  if (!resendKey) throw new Error("RESEND_API_KEY não configurada.");

  // O domínio remetente precisa estar verificado no Resend.
  // techiva.com.br ainda não está verificado, então usamos um domínio já verificado.
  const from = process.env["EMAIL_FROM"] ?? "TECH-IVA <nao-responda@hosphub.com.br>";

  const response = await fetch(`${API_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
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
