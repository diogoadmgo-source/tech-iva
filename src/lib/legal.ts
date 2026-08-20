/**
 * Dados do vendedor usados nas páginas legais exigidas pelo provedor de
 * pagamento (Paddle atua como Merchant of Record).
 *
 * ATENÇÃO: razão social, CNPJ e e-mail de suporte devem ser confirmados pelo
 * responsável legal antes da revisão de domínio do Paddle.
 */
export const SELLER = {
  legalName: "TECH-IVA",
  tradingName: "TECH-IVA",
  taxId: "61.421.466/0001-55",
  supportEmail: "suporte@tech-iva.com.br",
  country: "Brasil",
  jurisdiction: "Brasil",
} as const;

export const REFUND_DAYS = 30;

export const PADDLE_BUYER_TERMS = "https://www.paddle.com/legal/checkout-buyer-terms";
export const PADDLE_REFUND_POLICY = "https://www.paddle.com/legal/refund-policy";
export const PADDLE_PORTAL = "https://paddle.net";

export const LEGAL_UPDATED_AT = "20 de agosto de 2026";

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};
