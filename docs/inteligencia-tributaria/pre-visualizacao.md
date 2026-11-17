# Pré-visualização do Supabase × banco principal

Registro de 17/11/2026. O banco principal (**fluxa-dev**, `lfufwoirpwlsdmststbr`) **não foi
alterado**: nele só houve leitura (lista de migrations registradas e existência de objetos).
Tudo o que foi escrito ficou na pré-visualização `mcijfmuuamhyrtxalatp`, criada sozinha pelo
Supabase quando o PR #1 foi aberto (integração Supabase ↔ GitHub ligada no fluxa-dev).

## 1. Por que a pré-visualização parou

A pré-visualização começa vazia e roda as migrations do repositório em ordem. Ela registrou
20 migrations e parou na 21ª:

`supabase/migrations/20260817192810_735bbf89-a2d7-4955-a892-63199d384a92.sql`

Essa migration dá o papel `platform_admin` e cria o perfil de um usuário fixo
(`bd3cd68f-…`). No fluxa-dev esse usuário existe, e a migration rodou em 17/08. Num banco
vazio ele não existe, e a FK `memberships_user_id_fkey` falha. É a mesma causa provável do
estado `MIGRATIONS_FAILED` da branch `main` no painel do Supabase desde 17/08.

**O que foi feito**, só na pré-visualização: um usuário de teste com esse mesmo id
(e-mail fictício `preview-admin@preview.invalid`, sem senha) foi inserido em
`auth.users`. A migration antiga não foi alterada, nem no repositório nem no fluxa-dev.

Correção definitiva possível, ainda **não feita** e fora do escopo deste PR: a migration só
insere o membership se o usuário existir em `auth.users`. Isso exige alterar uma migration
antiga, o que depende de autorização.

## 2. Diferenças entre o repositório e o que o fluxa-dev registrou

Comparação entre os arquivos em `supabase/migrations/` e a tabela
`supabase_migrations.schema_migrations` do fluxa-dev (só leitura):

| Situação | Arquivo no repositório | No fluxa-dev |
| --- | --- | --- |
| Mesmo nome, outra versão e conteúdo diferente | `20260818200000_split_premissas_antecipacao.sql` (9.726 bytes) | registrada como `20260818173625` (7.851 bytes) |
| Mesmo nome, outra versão e conteúdo diferente | `20260820150000_dfe_distribuicao_estado_e_cofre.sql` (2.211 bytes) | registrada como `20260820123740` (2.549 bytes) |
| Não aplicada | `20260926030000_0235_retorno_da_receita_registrado_e_24h.sql` | ausente: a tabela `rtc_webhook_recebido` não existe e `rtc_apuracao_receber_tiquete` ainda tem 2 parâmetros |
| Deste PR, não aplicadas | `…_0240_…` e `…_0241_…` | ausentes (correto) |

Todas as 138 versões registradas no fluxa-dev existem no repositório.

**Consequência para o merge:** com a integração ligada, um merge na `main` deve tentar aplicar
no fluxa-dev **as 5 migrations acima**, e não só as duas deste PR. Isso inclui reexecutar
as duas de nome duplicado, com conteúdo diferente do que está no banco, e aplicar a 0235.
O comentário da 0235 diz que ela precisa ser aplicada antes de publicar o código do mesmo
commit. Isso precisa ser decidido antes de qualquer merge.

## 3. Validação das migrations 0240 e 0241 na pré-visualização

Ver a seção atualizada abaixo, preenchida com o resultado real da execução.
