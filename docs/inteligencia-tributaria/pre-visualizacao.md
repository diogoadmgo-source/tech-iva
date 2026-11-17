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

### Dados de apoio criados só na pré-visualização

Algumas migrations antigas usam ids que só existem no fluxa-dev. Os registros abaixo foram
criados **apenas** na pré-visualização, para que a sequência de migrations do repositório
chegue até a 0240 e a 0241 sem alterar nenhuma migration:

| Registro | Para qual migration | Origem do id |
| --- | --- | --- |
| `auth.users` `bd3cd68f-…` (`preview-admin@preview.invalid`, sem senha) | `20260817192810_735bbf89…` (papel `platform_admin` + perfil) | usuário real do fluxa-dev |
| `tenants` `40bb64ba-…`, canal "Canal de teste (pré-visualização)" | `20260817211332_dd9fbc30…` (regra de comissão do canal) | canal "Contábil Alfa" do seed, que no fluxa-dev recebeu esse id aleatório e foi removido depois pela 0215 |
| `schema_migrations` marca `20260818200000` e `20260820150000` como aplicadas, sem executar | arquivos duplicados (ver seção 2) | espelha o fluxa-dev, onde o mesmo conteúdo está aplicado como `20260818173625` e `20260820123740` |

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

**Confirmado na pré-visualização:** o repositório tem as duas versões de
`split_premissas_antecipacao`. Uma é a exportada do banco (`20260818173625`) e a outra é a
original comentada (`20260818200000`). Rodando as duas em ordem, a segunda falha com
`project_cash_sql: nenhuma substituição aplicada`, porque ela só funciona uma vez: a
primeira já fez as substituições. A sequência travou nesse ponto, em 106 de 143.

**Consequência para o merge:** com a integração ligada, um merge na `main` deve tentar aplicar
no fluxa-dev **as 5 migrations acima**, e não só as duas deste PR. Isso inclui reexecutar
as duas de nome duplicado, com conteúdo diferente do que está no banco, e aplicar a 0235.
O comentário da 0235 diz que ela precisa ser aplicada antes de publicar o código do mesmo
commit. Isso precisa ser decidido antes de qualquer merge.

## 3. Validação das migrations 0240 e 0241 na pré-visualização

Com os dados de apoio da seção 1, a pré-visualização registrou as **143 migrations** do
repositório, incluindo a 0235, a 0240 e a 0241. Tudo abaixo foi executado em
`mcijfmuuamhyrtxalatp` em 17/11/2026. Nada foi executado no fluxa-dev.

### 3.1 Catálogo (consultas de leitura)

| Verificação | Resultado |
| --- | --- |
| Tabelas do módulo com RLS ligado (lista explícita de 16) | 16 de 16 |
| Privilégios INSERT/UPDATE/DELETE/TRUNCATE de `authenticated` nas 16 tabelas | 0 |
| Privilégios de `anon` nas 16 tabelas | 0 |
| Funções `tax_*` executáveis por `anon` | 0 de 22 |
| Funções SECURITY DEFINER sem `pg_temp` no `search_path` | 0 |
| `tax_audit` executável por `authenticated` | não |
| Bucket `tax-imports` | privado, limite 31.457.280 bytes |
| Bucket `tax-evidences` | privado, limite 20.971.520 bytes |
| Políticas de Storage do módulo | 4 |
| Fontes cadastradas em `tax_sources` | 6, com os status esperados |

### 3.2 Teste de fumaça (transação desfeita no final)

Um bloco `DO` simulou usuários com `set local role authenticated` e `request.jwt.claims`,
usando os tenants que existem na pré-visualização. O bloco termina com `raise exception`,
então **nada ficou gravado**.

| Passo | Resultado |
| --- | --- |
| Upload no caminho gerado pela importação | aceito |
| Upload em outro caminho | recusado pela RLS |
| `tax_import_add_items` com 5 linhas | 5 inseridas |
| `tax_import_finalize` | 2 válidos, 1 repetido, 1 inválido, 1 já existente, 3 relacionamentos novos, 13 ms |
| INSERT/UPDATE/DELETE direto nas tabelas | negado |
| Owner de outra empresa (Gama) | vê 0 importações, 0 entidades e 0 arquivos |
| `tax_import_add_items` na importação de outra empresa | `forbidden` |
| `anon` | `permission denied` |
| UPDATE em `tax_audit_logs` | `registro imutável: UPDATE em tax_audit_logs` |
| Registros de auditoria | 2 em `tax_audit_logs` e 2 em `audit_log` |

## 4. Incompatibilidades entre a pré-visualização e o fluxa-dev

1. **Usuário e canal fixos em migrations antigas** (seção 1). A pré-visualização só avança
   com os dados de apoio. O fluxa-dev não é afetado, porque lá esses registros existem ou
   já existiram.
2. **Migrations duplicadas e a 0235 pendente** (seção 2). O repositório e o fluxa-dev não
   estão alinhados. Isso vem de antes deste módulo e afeta qualquer merge na `main`.
3. **Migrations fora de ordem.** O Supabase avisou que a pré-visualização recebeu
   migrations com versão anterior à última aplicada. É consequência das marcações manuais da
   seção 1. No fluxa-dev, as versões 0240 e 0241 (`20261117…`) são posteriores à última
   registrada (`20260923200000`), então este aviso não se aplica a elas.
4. **Tenants do seed.** A 0006 cria os tenants de exemplo com ids aleatórios, e a 0215 os
   remove por id fixo. Num banco novo a remoção não os encontra. A pré-visualização mantém
   Alfa, Beta, Gama e Filial, e o fluxa-dev mantém só TECH-IVA e GDB. Os testes de fumaça
   usaram esses tenants de exemplo, que não existem no fluxa-dev.
5. **Prefixo `tax_` já usado.** O banco tem 49 tabelas `tax_cash_events_*` (partições de
   outro módulo), num total de 65 tabelas com esse prefixo. As verificações de catálogo da
   suíte (`db/tests/tax_intel/70_separation.sql`) contavam tabelas pelo prefixo e dariam
   número errado num banco real. Foram trocadas por uma lista explícita das 16 tabelas do
   módulo, e a suíte passou de novo (253 de 253). Nenhuma função antiga usa o prefixo
   `tax_`, então as verificações de funções continuam por prefixo.
6. **Pré-visualização sem dados reais.** Ela não tem os dados do fluxa-dev. Desempenho com
   o volume real e o comportamento com os usuários reais só podem ser medidos depois de uma
   aplicação autorizada.
