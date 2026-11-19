# Extensão TECH-IVA · Consulta Optantes

Ajuda a equipe a consultar, na Consulta Optantes do Portal do Simples Nacional,
a opção pelo regime regular de IBS e de CBS dos optantes do Simples.

* A consulta continua sendo feita pela pessoa: a extensão só preenche o CNPJ e
  devolve o texto do resultado ao TECH-IVA. Ela **não** clica em Consultar e
  **não** interage com o captcha da Receita.
* Nada é enviado para fora do navegador: o resultado vai da aba da Receita para
  a aba do TECH-IVA, que grava com o usuário logado (RPC
  `tax_register_consulta_optantes`, migration 0254).

## Instalar (Chrome ou Edge)

1. Baixe a pasta `extensao-consulta-optantes` (ou o .zip) e descompacte.
2. Abra `chrome://extensions` (no Edge, `edge://extensions`).
3. Ligue o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e escolha a pasta.

Se o TECH-IVA estiver num domínio próprio (fora de `*.lovable.app`), inclua o
domínio em `content_scripts[1].matches` do `manifest.json`.

## Usar

Na tela **Simples híbrido** do módulo, clique em **Consultar** na linha. A aba
da Receita abre com o CNPJ preenchido; clique em Consultar lá. O resultado volta
sozinho para o TECH-IVA e é gravado.
