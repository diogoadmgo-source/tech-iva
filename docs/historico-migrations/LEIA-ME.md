# Migrations retiradas da pasta executável

Arquivos que estavam em `supabase/migrations/` e foram retirados em 17/11/2026, sem nenhuma
alteração de conteúdo (MD5 igual ao da `main` em `e6d3c16`). A extensão `.sql.txt` impede
que qualquer ferramenta os execute.

| Arquivo retirado | Mesmo conteúdo aplicado no fluxa-dev como | Diferença real |
| --- | --- | --- |
| `20260818200000_split_premissas_antecipacao.sql.txt` | `20260818173625_split_premissas_antecipacao.sql` | formatação, texto de uma mensagem de erro e 2 variáveis não usadas num bloco de teste |
| `20260820150000_dfe_distribuicao_estado_e_cofre.sql.txt` | `20260820123740_dfe_distribuicao_estado_e_cofre.sql` | só comentários |

O diff completo está em `diferencas.diff`.

Por que foram retiradas: as duas entraram no repositório em 20/08/2026 (commit `c6a6305`),
mas o banco registrou o mesmo SQL com outra versão, aplicada pelo MCP. Em 16/09/2026 o
commit `c96e6c6` trouxe as versões do banco para o repositório, e as antigas ficaram. Assim,
qualquer `supabase db push` ou implantação automática tentaria rodá-las de novo. A
`split_premissas` falha nessa segunda execução (`project_cash_sql: nenhuma substituição
aplicada`), o que foi confirmado na pré-visualização do PR #1.

O comentário da linha 4 de `20260818173625_split_premissas_antecipacao.sql` ainda aponta
para o caminho antigo. Ele não foi corrigido porque aquela migration já está aplicada e não
deve ser alterada: o arquivo citado é o `.sql.txt` desta pasta.

Efeito no fluxa-dev: nenhum. Essas duas versões nunca foram registradas lá.

Para desfazer: `git revert` do commit que as moveu devolve os arquivos a
`supabase/migrations/` com o conteúdo original.
