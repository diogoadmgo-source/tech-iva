import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/marketing/legal-page";
import { SELLER, type LegalSection } from "@/lib/legal";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Aviso de privacidade · TECH-IVA" },
      {
        name: "description",
        content:
          "Quais dados a TECH-IVA coleta, para quê, com quem compartilha, por quanto tempo guarda e como você exerce seus direitos.",
      },
      { property: "og:title", content: "Aviso de privacidade · TECH-IVA" },
      {
        property: "og:description",
        content: "Tratamento de dados pessoais na plataforma TECH-IVA, base legal, retenção e direitos do titular.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyRoute,
});

const SECTIONS: LegalSection[] = [
  {
    heading: "Quem trata os seus dados",
    paragraphs: [
      `${SELLER.legalName} (CNPJ ${SELLER.taxId}), nome comercial ${SELLER.tradingName}, é a controladora dos dados pessoais tratados na plataforma: decide as finalidades e os meios do tratamento.`,
      `Pedidos sobre privacidade podem ser enviados para ${SELLER.supportEmail}.`,
    ],
  },
  {
    heading: "Dados que coletamos",
    bullets: [
      "Cadastro e conta: nome, e-mail, senha em forma cifrada, papel de acesso, organização vinculada e configuração de segundo fator.",
      "Dados da empresa: CNPJ, razão social, endereço, regime tributário e dados públicos do cadastro fiscal.",
      "Conteúdo enviado por você: documentos fiscais eletrônicos, planilhas, certificados digitais e credenciais de integração.",
      "Uso e telemetria mínima: registros de acesso, ações administrativas, endereço IP, identificadores de dispositivo e navegador.",
      "Suporte: mensagens, anexos e histórico de atendimento.",
    ],
  },
  {
    heading: "Para que usamos",
    bullets: [
      "Criar e manter sua conta e o controle de acesso por organização (execução do contrato).",
      "Prestar o serviço: leitura de documentos, cálculo com o motor oficial, apuração, conciliação e relatórios (execução do contrato).",
      "Segurança, prevenção a fraude e trilha de auditoria de ações sensíveis (legítimo interesse e obrigação legal).",
      "Suporte ao cliente e comunicação operacional sobre o serviço (execução do contrato).",
      "Melhoria do produto, com dados agregados e sem identificar pessoas (legítimo interesse).",
      "Comunicação de marketing, apenas com o seu consentimento e com descadastramento em qualquer momento (consentimento).",
    ],
  },
  {
    heading: "Com quem compartilhamos",
    bullets: [
      "Provedores de infraestrutura e operação: hospedagem, banco de dados, envio de e-mail e observabilidade, como operadores, sob contrato.",
      "Merchant of Record: a Paddle.com processa a venda, a gestão da assinatura, o pagamento, a conformidade tributária e a emissão de faturas.",
      "Assessores profissionais: advogados, contadores e auditores, quando necessário.",
      "Autoridades públicas, quando houver obrigação legal, regulatória ou ordem judicial.",
    ],
    paragraphs: ["Não vendemos dados pessoais e não os cedemos para publicidade de terceiros."],
  },
  {
    heading: "Certificados e credenciais",
    paragraphs: [
      "Certificado digital, senha do certificado e chaves de integração são cifrados antes de gravar, guardados em área privada e usados somente para as finalidades declaradas no momento do envio.",
      "Cada uso fica registrado em trilha visível para a sua organização. A revogação pode ser feita por você a qualquer momento e apaga o material sensível.",
    ],
  },
  {
    heading: "Retenção",
    paragraphs: [
      "Mantemos os dados enquanto a conta estiver ativa. Encerrada a conta, os dados de conta e conteúdo são excluídos ou anonimizados em até 90 dias, salvo prazo legal maior.",
      "Registros de auditoria e dados exigidos por lei fiscal ou contábil são mantidos pelo prazo legal aplicável, mesmo após o encerramento.",
    ],
  },
  {
    heading: "Seus direitos",
    paragraphs: [
      "Você pode pedir confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação, informação sobre compartilhamentos e revogação de consentimento, nos termos da LGPD.",
    ],
    bullets: [
      `Envie o pedido para ${SELLER.supportEmail}; respondemos em até 15 dias.`,
      "Pedidos de eliminação podem ser limitados por obrigação legal de retenção, e nesse caso explicamos o motivo.",
      "Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).",
    ],
  },
  {
    heading: "Segurança",
    paragraphs: [
      "Adotamos medidas técnicas e organizacionais adequadas: cifragem em trânsito e em repouso para material sensível, isolamento de dados por organização no próprio banco, controle de acesso por papel, segundo fator obrigatório para papéis administrativos e registro de ações sensíveis.",
      "O motor de cálculo roda na nossa infraestrutura, sem envio do seu movimento fiscal para fora.",
    ],
  },
  {
    heading: "Cookies",
    paragraphs: [
      "Usamos apenas cookies e armazenamento local essenciais: manter a sessão autenticada, lembrar a organização selecionada e proteger o formulário de acesso. Não usamos cookies de publicidade.",
      "Você pode apagar esses dados nas configurações do navegador; nesse caso será preciso entrar novamente.",
    ],
  },
  {
    heading: "Transferências internacionais",
    paragraphs: [
      `Nossa operação principal fica no ${SELLER.country}. Alguns provedores podem processar dados no exterior; nesse caso exigimos cláusulas contratuais de proteção e garantias equivalentes às da LGPD.`,
    ],
  },
];

function PrivacyRoute() {
  return (
    <LegalPage
      title="Aviso de privacidade"
      intro="Este aviso explica quais dados pessoais tratamos na plataforma TECH-IVA, com qual base legal, com quem compartilhamos e como você exerce seus direitos."
      sections={SECTIONS}
    />
  );
}
