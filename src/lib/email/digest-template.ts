/**
 * Template HTML do resumo semanal (TECH-IVA) — bloco 3.10.
 * Recebe os dados já agregados por weekly_digest_batch.
 */

const LOGO_URL =
  "https://project--855fd1d6-ffd5-4396-8e4c-6ec320982648.lovable.app/__l5e/assets-v1/61c2ed72-5485-4a53-b97e-1dd7fb61d35e/techiva-logo.png";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type DigestAlert = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  created_at: string;
};

export type DigestPayload = {
  tenant_id: string;
  tenant_name: string;
  recipients: string[];
  kpis: { gap_30_cents: number; gap_90_cents: number; tax_out_month_cents: number };
  open_alerts: number;
  top_alerts: DigestAlert[];
  generated_at: string;
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#f87171",
  warning: "#fbbf24",
  info: "#94a3b8",
};

export function renderDigestEmail(payload: DigestPayload, appUrl: string) {
  const gap30 = payload.kpis.gap_30_cents;
  const tone = gap30 < 0 ? "#f87171" : "#34d399";
  const link = `${appUrl}/t/${payload.tenant_id}/cash`;

  const alertsHtml =
    payload.top_alerts.length === 0
      ? `<p style="margin:0;color:#94a3b8;font-size:14px">Nenhum alerta aberto nesta semana.</p>`
      : payload.top_alerts
          .map(
            (a) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #1e293b">
          <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${
            SEVERITY_COLOR[a.severity] ?? "#94a3b8"
          };margin-right:8px"></span>
          <span style="color:#e2e8f0;font-size:14px">${escapeHtml(a.title)}</span>
          <div style="margin-top:4px;color:#64748b;font-size:12px;font-family:ui-monospace,monospace">${escapeHtml(a.kind)}</div>
        </td>
      </tr>`,
          )
          .join("");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;background:#0b1120;font-family:Inter,-apple-system,Segoe UI,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1120;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px">
        <tr><td style="padding-bottom:24px">
          <img src="${LOGO_URL}" alt="TECH-IVA" width="132" style="display:block" />
        </td></tr>
        <tr><td>
          <h1 style="margin:0 0 4px;color:#f8fafc;font-size:20px">Resumo semanal</h1>
          <p style="margin:0 0 24px;color:#94a3b8;font-size:14px">${escapeHtml(payload.tenant_name)}</p>
        </td></tr>
        <tr><td style="padding-bottom:8px">
          <div style="border:1px solid #1e293b;border-radius:12px;padding:16px;background:#111c31">
            <p style="margin:0;color:#94a3b8;font-size:12px">Caixa projetado em 30 dias</p>
            <p style="margin:6px 0 0;color:${tone};font-size:24px;font-weight:600;font-family:ui-monospace,monospace">${brl(gap30)}</p>
          </div>
        </td></tr>
        <tr><td style="padding:8px 0 24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:50%;padding-right:6px">
                <div style="border:1px solid #1e293b;border-radius:12px;padding:14px">
                  <p style="margin:0;color:#94a3b8;font-size:12px">90 dias</p>
                  <p style="margin:4px 0 0;color:#e2e8f0;font-size:16px;font-family:ui-monospace,monospace">${brl(payload.kpis.gap_90_cents)}</p>
                </div>
              </td>
              <td style="width:50%;padding-left:6px">
                <div style="border:1px solid #1e293b;border-radius:12px;padding:14px">
                  <p style="margin:0;color:#94a3b8;font-size:12px">Imposto do mês</p>
                  <p style="margin:4px 0 0;color:#e2e8f0;font-size:16px;font-family:ui-monospace,monospace">${brl(payload.kpis.tax_out_month_cents)}</p>
                </div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td>
          <h2 style="margin:0 0 8px;color:#f8fafc;font-size:14px">Alertas abertos (${payload.open_alerts})</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${alertsHtml}</table>
        </td></tr>
        <tr><td style="padding-top:28px">
          <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px">Abrir o Caixa do Imposto</a>
        </td></tr>
        <tr><td style="padding-top:28px;border-top:1px solid #1e293b">
          <p style="margin:16px 0 0;color:#64748b;font-size:12px">
            Você recebe este resumo porque é responsável ou financeiro nesta organização.
            Ajuste o envio em Alertas → Preferências.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return {
    subject: `Resumo semanal · ${payload.tenant_name}`,
    html,
  };
}
