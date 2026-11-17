# Pré-visualização do PR de regularização

Projeto de pré-visualização `osyqcnvsgsrsncvemuln` (Postgres 17.12), criado vazio pelo
Supabase ao abrir o PR, a partir desta branch. Nada foi feito no fluxa-dev.

## 1ª execução

Registrou 20 migrations e parou na 21ª, `20260817192810_735bbf89…`. É a mesma falha
conhecida desde 17/08: a migration dá `platform_admin` a um usuário que só existe no
fluxa-dev.

## Dados de apoio inseridos só na pré-visualização

Nenhuma migration foi alterada. Foram inseridos os dois registros que migrations antigas
esperam encontrar:

| Registro | Para qual migration |
| --- | --- |
| `auth.users` `bd3cd68f-…` (`preview-admin@preview.invalid`, sem senha) | `20260817192810_735bbf89…` |
| `tenants` `40bb64ba-…` (canal "Canal de teste (pré-visualização)") | `20260817211332_dd9fbc30…` |

Ao contrário da pré-visualização do PR #1, **não foi preciso marcar nenhuma migration como
aplicada sem executar**: as duplicadas saíram da pasta.

## 2ª execução, com os dados de apoio

Migrations ✅, sem aviso de "fora de ordem" (o PR #1 tinha esse aviso por causa das
duplicadas). Conferido na pré-visualização:

| Verificação | Resultado |
| --- | --- |
| Migrations registradas | **139**, igual ao número de arquivos em `supabase/migrations/` |
| Última versão | `20260926030000` (0235) |
| Versões duplicadas registradas | 0 |
| Objeto da 0235 (`rtc_webhook_recebido`) | criado |

## Reprodução local com o Supabase completo

O mesmo histórico também rodou do zero num Supabase local (CLI 2.122.1, Postgres 17.11,
com Auth, REST e Storage), com os mesmos dois dados de apoio. Eles ficaram como arquivos
**só locais**, fora do repositório. Foram 141 migrations aplicadas (139 do repositório + 2
de apoio), sem erro.
