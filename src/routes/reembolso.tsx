import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/marketing/legal-page";
import {
  PADDLE_PORTAL,
  PADDLE_REFUND_POLICY,
  REFUND_DAYS,
  SELLER,
  type LegalSection,
} from "@/lib/legal";

export const Route = createFileRoute("/reembolso")({
  head: () => ({
    meta: [
      { title: "Política de reembolso · TECH-IVA" },
      {
        name: "description",
        content: `Garantia de ${REFUND_DAYS} dias: como pedir reembolso da assinatura TECH-IVA e como o pedido é processado pelo provedor de pagamento.`,
      },
      { property: "og:title", content: "Política de reembolso · TECH-IVA" },
      {
        property: "og:description",
        content: `Reembolso integral em até ${REFUND_DAYS} dias da cobrança, processado pelo nosso revendedor.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RefundRoute,
});

const SECTIONS: LegalSection[] = [
  {
    heading: `Garantia de ${REFUND_DAYS} dias`,
    paragraphs: [
      `Você tem ${REFUND_DAYS} dias, contados da data da cobrança, para pedir reembolso integral da assinatura, inclusive por simples desistência. Não pedimos justificativa.`,
      "Cobranças anteriores a esse prazo, já consumidas em períodos encerrados, não são reembolsadas automaticamente — mas você pode nos escrever e avaliamos caso a caso, inclusive em falha nossa de serviço.",
    ],
  },
  {
    heading: "Como pedir",
    bullets: [
      `Pelo provedor de pagamento: acesse ${PADDLE_PORTAL} com o e-mail usado na compra e solicite o reembolso.`,
      `Por e-mail: escreva para ${SELLER.supportEmail} informando o e-mail da compra e o número da fatura; encaminhamos o pedido ao provedor.`,
      "Pela própria plataforma: na tela de planos, aba Histórico, você encontra as faturas e o acesso ao portal de cobrança.",
    ],
  },
  {
    heading: "Prazo de processamento",
    paragraphs: [
      "Aprovado o reembolso, o valor é devolvido pelo mesmo meio de pagamento usado na compra. O crédito costuma aparecer em até 10 dias úteis, conforme o prazo do emissor do cartão ou do meio de pagamento.",
      "O reembolso é processado pelo nosso revendedor Paddle.com, que é o Merchant of Record dos pedidos e responde pelas devoluções.",
    ],
  },
  {
    heading: "Cancelamento da assinatura",
    paragraphs: [
      "Cancelar e pedir reembolso são coisas diferentes. Ao cancelar, a renovação para e o acesso continua até o fim do período já pago. Ao pedir reembolso dentro do prazo, a cobrança é devolvida.",
      "O cancelamento pode ser feito pela plataforma, na tela de planos, sem precisar falar com nosso time.",
    ],
  },
  {
    heading: "Política do provedor",
    paragraphs: [
      `Além desta política, aplica-se a política de reembolso do provedor de pagamento: ${PADDLE_REFUND_POLICY}. Em caso de divergência, prevalece a condição mais favorável a você.`,
    ],
  },
];

function RefundRoute() {
  return (
    <LegalPage
      title="Política de reembolso"
      intro={`Assinatura com garantia de ${REFUND_DAYS} dias. Se a plataforma não servir para a sua empresa, devolvemos o valor da cobrança.`}
      sections={SECTIONS}
    />
  );
}
