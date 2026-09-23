# Esta pasta NÃO é a fonte da verdade

**A fonte da verdade do banco é `supabase/migrations/`.** Decidido em 23/09/2026.

## O que esta pasta é

O histórico **escrito à mão**: arquivos numerados (`0001` … `0230`), legíveis,
com o comentário de por que cada mudança foi feita.

## O que esta pasta não é

Nenhuma ferramenta lê esta pasta. Nada aqui é aplicado automaticamente.
Conferido em 23/09/2026: `package.json`, `supabase/config.toml` e a configuração
do Vite não a mencionam em lugar nenhum.

## Por que não foi apagada

Boa parte do que está aqui **está em produção**, mas aplicada com nome
automático gerado pelo Lovable — nomes como
`20260820161232_e175061c-fc6e-4f41-99c0-0da08aa0926f`. Para essas mudanças,
o arquivo daqui é o **único registro legível** do que foi feito e por quê.

Conferido em 23/09/2026, por amostragem: `rtc_quota_estornar`, `can_price`,
`price_credit_factor`, `price_scenario_compute` e `register_credential` são
definidas em arquivos desta pasta e existem em produção.

Apagar isto não ganharia nada e destruiria documentação.

## Cuidado com a numeração

Os números daqui e os de `supabase/migrations/` **seguem contagens separadas** e
já colidiram: em 23/09/2026 passaram a existir dois "0230" diferentes —
`0230_reference_tables_membership_scope` aqui e `0230_diagnostico_acumula` lá.
São mudanças distintas. O número não identifica nada sozinho.

## Se você vai criar uma migração nova

Crie em `supabase/migrations/`, com o carimbo de data no nome
(`AAAAMMDDHHMMSS_descricao.sql`). Não crie aqui.
