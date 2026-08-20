import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/marketing/legal-page";
import { PADDLE_BUYER_TERMS, REFUND_DAYS, SELLER, type LegalSection } from "@/lib/legal";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos e condições · TECH-IVA" },
      {
        name: "description",
        content:
          "Termos e condições de uso da plataforma TECH-IVA, incluindo pagamento, assinatura, uso aceitável e encerramento de acesso.",
      },
      { property: "og:title", content: "Termos e condições · TECH-IVA" },
      {
        property: "og:description",
        content: "Condições contratuais de uso da plataforma TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsRoute,
});

const SECTIONS: LegalSection[] = [
  {
    heading: "Quem é o fornecedor",
    paragraphs: [
      `O serviço é fornecido por ${SELLER.legalName} (CNPJ ${SELLER.taxId}), que atua sob o nome comercial ${SELLER.tradingName} e é a parte com quem você contrata. Ao contratar, você contrata com ${SELLER.legalName}, não com terceiros.`,
      `Dúvidas sobre estes termos podem ser enviadas para ${SELLER.supportEmail}.`,
    ],
  },
  {
    heading: "Aceite dos termos",
    paragraphs: [
      "Ao criar conta, acessar ou continuar usando a plataforma, você declara que leu e concorda com estes termos. Se você usa o serviço em nome de uma empresa, declara ter poderes para obrigá-la; se usa como pessoa física, declara ser maior de idade.",
      "Alterações relevantes destes termos são comunicadas na própria plataforma. O uso após a comunicação vale como aceite da versão atualizada.",
    ],
  },
  {
    heading: "O que a plataforma faz",
    paragraphs: [
      "A TECH-IVA lê documentos fiscais da sua empresa, executa o cálculo de IBS, CBS e IS com o motor oficial da Receita Federal e apresenta projeção de caixa, apuração, conciliação e relatórios de apoio.",
      "A plataforma é ferramenta de apoio à gestão. Ela não substitui a escrituração, a entrega de obrigações acessórias, nem a orientação de contador ou advogado responsável pela empresa.",
    ],
  },
  {
    heading: "Conta, credenciais e informações",
    bullets: [
      "Você é responsável por manter suas credenciais em sigilo e por toda atividade realizada na sua conta.",
      "Papéis com poder administrativo exigem segundo fator (MFA); não é permitido compartilhar contas entre pessoas.",
      "Você deve fornecer informações cadastrais corretas e mantê-las atualizadas, inclusive CNPJ e responsáveis autorizados.",
      "Certificados digitais e chaves de integração enviados por você são usados apenas para as finalidades declaradas no momento do envio.",
    ],
  },
  {
    heading: "Uso aceitável",
    paragraphs: ["Ao usar a plataforma, você não pode:"],
    bullets: [
      "usar o serviço para finalidade ilícita ou para simular, ocultar ou fraudar operações fiscais;",
      "enviar dados de terceiros sem autorização, praticar spam ou fraude;",
      "violar direitos de propriedade intelectual, seus ou de terceiros;",
      "interferir na segurança do serviço: malware, varredura de vulnerabilidades, tentativa de acesso a dados de outro cliente, raspagem automatizada ou burla de limites técnicos;",
      "fazer engenharia reversa, revender ou redistribuir o serviço fora do plano contratado.",
    ],
  },
  {
    heading: "Propriedade intelectual",
    paragraphs: [
      `O software, a documentação, a marca e os demais elementos da plataforma permanecem de titularidade de ${SELLER.legalName}. Você recebe apenas um direito de uso limitado, não exclusivo e não transferível, restrito ao plano contratado e ao prazo da assinatura.`,
      "Os dados fiscais e cadastrais que você envia continuam seus. Você concede licença limitada para hospedar e processar esses dados exclusivamente para prestar o serviço.",
    ],
  },
  {
    heading: "Disponibilidade do serviço",
    paragraphs: [
      "Não há garantia de funcionamento ininterrupto ou livre de erros. Janelas de manutenção, indisponibilidade de serviços oficiais da Receita Federal e falhas de terceiros podem afetar cálculos e consultas.",
      "Quando o motor oficial de cálculo estiver indisponível, a plataforma informa a indisponibilidade em vez de exibir número estimado.",
      "Na máxima extensão permitida pela lei, ficam afastadas as garantias implícitas de adequação a finalidade específica e de comerciabilidade.",
    ],
  },
  {
    heading: "Pagamento e assinatura",
    paragraphs: [
      `Os planos são cobrados por assinatura recorrente, no ciclo escolhido na contratação, com renovação automática até o cancelamento. Preços, tributos aplicáveis, faturamento, alteração de plano, cancelamento e reembolso seguem os termos de compra do nosso revendedor: ${PADDLE_BUYER_TERMS}.`,
      `Você pode cancelar a qualquer momento pela própria plataforma; o acesso permanece até o fim do período já pago. Pedidos de reembolso seguem a política de reembolso, com prazo de ${REFUND_DAYS} dias.`,
    ],
  },
  {
    heading: "Revendedor e Merchant of Record",
    paragraphs: [
      "Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries and handles returns.",
      "Em português: o processo de pedido é conduzido pelo nosso revendedor online Paddle.com, que é o Merchant of Record de todos os pedidos. A Paddle atende as solicitações de suporte relativas à compra e cuida das devoluções.",
    ],
  },
  {
    heading: "Suspensão e encerramento",
    paragraphs: [
      "Podemos suspender ou encerrar o acesso em caso de violação material destes termos, inadimplência, risco de segurança ou fraude, ou violações repetidas ou graves das regras de uso aceitável. Quando possível, avisamos antes e damos prazo para correção.",
      "Encerrado o acesso, você pode solicitar a exportação dos seus dados em até 30 dias; após esse prazo os dados podem ser excluídos ou anonimizados, salvo obrigação legal de retenção.",
    ],
  },
  {
    heading: "Limitação de responsabilidade",
    paragraphs: [
      "Na máxima extensão permitida pela lei, nossa responsabilidade total fica limitada ao valor das mensalidades pagas por você nos 12 meses anteriores ao evento.",
      "Não respondemos por danos indiretos, lucros cessantes, perda de dados ou perda de reputação. Não se limitam responsabilidades por dolo, fraude, morte ou dano pessoal, quando a lei não permitir limitação.",
      "Você se responsabiliza por reclamações decorrentes dos dados que enviar, do uso ilícito do serviço ou do descumprimento destes termos.",
    ],
  },
  {
    heading: "Lei aplicável e foro",
    paragraphs: [
      `Estes termos são regidos pelas leis do ${SELLER.jurisdiction}. Controvérsias serão submetidas ao foro do domicílio do fornecedor, ressalvada a competência legal do foro do consumidor.`,
      "Você não pode ceder este contrato sem nosso consentimento. Podemos cedê-lo em caso de reorganização societária, fusão ou aquisição. Nenhuma das partes responde por eventos fora de seu controle razoável.",
    ],
  },
];

function TermsRoute() {
  return (
    <LegalPage
      title="Termos e condições"
      intro="Estas são as condições que regem o uso da plataforma TECH-IVA, a contratação dos planos e o encerramento do acesso."
      sections={SECTIONS}
    />
  );
}
