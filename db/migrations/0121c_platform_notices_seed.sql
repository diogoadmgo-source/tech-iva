-- 0121c_platform_notices_seed.sql
-- ESPELHO do conteúdo de platform_notices aplicado no banco (0091/0092 criaram a
-- tabela; os avisos split_adiado e conformidade_2026 vieram com a 0121b).
--
-- Estes textos NÃO são dado fictício: são a copy institucional que a interface lê
-- em runtime (notices_for(scope)). Sem eles um ambiente novo mostra as telas de
-- Apuração, Caixa, Simulador, Validador e Integrações RTC sem nenhuma explicação
-- de limitação legal — que é exatamente o que não pode acontecer num produto que
-- fala de imposto. Idempotente: on conflict atualiza o texto.

insert into public.platform_notices (key, scope, severity, title, body, active) values

('apuracao_2026_declaratorio','apuracao','info',
 'Em 2026 o destaque é declaratório',
 'Durante 2026, CBS e IBS são destacados nos documentos fiscais mas não são somados ao total da operação e não há pagamento efetivo. Os valores exibidos aqui servem para você se preparar para 2027, quando o sistema definitivo entra em vigor.', true),

('apuracao_cancelamento','apuracao','warning',
 'Cancelamentos e devoluções ainda não entram na apuração',
 'A Apuração Assistida da Receita Federal ainda não trata documentos de cancelamento e devolução. Isso significa que uma nota cancelada continua contando como débito até que a Receita passe a tratá-la, e a nossa projeção de caixa herda a mesma limitação. Estamos acompanhando as próximas versões da plataforma.', true),

('apuracao_cota','apuracao','info',
 'A Receita limita 2 consultas por dia',
 'A API da Apuração Assistida permite 2 solicitações por dia para cada CNPJ. Fazemos 1 consulta automática por dia e deixamos a outra reservada para você pedir quando precisar. O arquivo enviado pela Receita fica disponível por 24 horas.', true),

('split_adiado','caixa','warning',
 'O split payment não começa em janeiro de 2027',
 'O Comitê Gestor do IBS informou em 12/08/2026 que o split payment não estará disponível em janeiro de 2027 — as instituições financeiras pediram prazo adicional. Ele virá depois, de forma gradual, e na primeira etapa será OPCIONAL e restrito a operações entre empresas. Para 2027 existe o RAD (Recolhimento pelo Adquirente), também opcional. Por isso a projeção assume, por padrão, a APURAÇÃO MENSAL: o imposto sai no vencimento da guia, não a cada recebimento. Você pode comparar as três modalidades nesta tela.', true),

('rtc_credencial_proprio','integracoes_rtc','info',
 'Opção 1 — Você mesmo gera a credencial (mais rápido)',
 '1. Acesse https://consumo.tributos.gov.br e entre com sua conta gov.br.
2. Se você não usa certificado de pessoa jurídica (e-CNPJ), clique no seu nome no canto superior direito e use "Representar" para atuar em nome da empresa.
3. No menu, procure o serviço "Gerar Credencial de Acesso para API".
4. Gere o par ClientId e ClientSecret e cole os dois campos aqui.

A credencial é sua e você pode revogá-la no portal a qualquer momento.', true),

('rtc_credencial_procurador','integracoes_rtc','info',
 'Opção 2 — Você nos autoriza como procurador (não precisa gerar nada)',
 '1. Acesse o site da Receita Federal e vá em Serviços > Negócios > Controle de Acesso.
2. Clique em "Minhas Autorizações de Acesso" e conceda autorização para o nosso CNPJ 61.421.466/0001-55 (confira a razão social exibida abaixo antes de autorizar).
3. Autorize os serviços: "Minhas Apurações Assistidas de CBS" e "Gerar Credencial de Acesso para API".
4. Volte aqui e clique em "Já autorizei" — nós geramos a credencial de procurador e cuidamos do resto.

A autorização só passa a valer após a nossa confirmação, e você pode cancelá-la quando quiser, direto no e-CAC.', true),

('calculadora_local','simulador','info',
 'Cálculo pelo motor oficial, sem enviar seus dados',
 'Usamos a Calculadora de Tributos da Receita Federal executada na nossa própria infraestrutura. Conforme o manual da RFB, o componente opera sem coleta de dados, sem telemetria e sem transmissão automática de informações: as operações que você simula não são enviadas à Administração Tributária. As regras de cálculo se atualizam automaticamente quando a Receita publica alterações.', true),

('conformidade_2026','validador','info',
 'Corrigir inconsistências até o fim do exercício evita sanções',
 'O CGIBS instituiu o Programa Nacional de Conformidade Tributária. Os contribuintes que aderirem e corrigirem inconsistências nas notas fiscais até o encerramento do exercício não ficam sujeitos às sanções previstas para essas ocorrências. Neste momento a prioridade declarada dos fiscos é orientar e permitir a regularização — é a melhor janela para acertar a parametrização do seu emissor.', true)

on conflict (key) do update
  set scope = excluded.scope, severity = excluded.severity, title = excluded.title,
      body = excluded.body, active = excluded.active, updated_at = now();
