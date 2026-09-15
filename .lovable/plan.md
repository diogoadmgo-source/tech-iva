# Aplicar o tema claro

## O que será alterado
- Manter estrutura, textos, funcionalidades e identidade visual atuais.
- Converter as superfícies globais para branco e cinzas claros, preservando o azul profundo e o ciano da paleta HOSPCOM.
- Ajustar textos, bordas, campos, menus, cartões, fundos públicos e estados interativos para contraste adequado no tema claro.
- Preservar as cores funcionais de sucesso, alerta, erro e regimes tributários.
- Adaptar brilhos e sombras do visual premium para uma aparência clara e sóbria, sem adicionar elementos.

## Verificação
- Conferir as telas públicas e internas em desktop e celular.
- Validar legibilidade, contraste, menus, campos, gráficos e estados de foco.
- Confirmar que nenhuma regra de negócio ou dado foi alterado.

## Detalhes técnicos
- Centralizar a mudança nos tokens semânticos globais para que todo o sistema herde o tema.
- Corrigir apenas exceções visuais que ainda dependam explicitamente de fundos escuros.
- Manter `.dark` compatível, mas fazer o tema claro ser o padrão efetivo da aplicação.
