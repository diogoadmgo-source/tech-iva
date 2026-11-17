# Parecer técnico final: aplicação de 0235, 0240 e 0241 no TechIVA-Prod

**Data:** 17/11/2026, 22h UTC
**Projeto:** TechIVA-Prod, ref `lfufwoirpwlsdmststbr`, org `dwzpegxlsflidyvwgqfh`, sa-east-1, Postgres 17.6
**Base:** dry-run oficial do usuário (0235 → 0240 → 0241), leituras somente leitura do TechIVA-Prod
e da pré-visualização do PR #1 (`mcijfmuuamhyrtxalatp`), e testes no Supabase local.
**Nada foi escrito no TechIVA-Prod.**

## Parecer

O SQL está **apto a ser aplicado**, mas só depois de três confirmações do usuário:

1. o backup lógico independente foi gerado e validado (seção 3);
2. PITR ou backup diário está confirmado no painel;
3. o Deploy to production está desligado.

Não achei incompatibilidade com o banco atual:

* **Dependências:** todas existem com a assinatura e os valores esperados.
* **Nomes:** nenhum objeto novo colide com um existente.
* **Dados:** as migrations não alteram nem apagam nenhuma linha que já exista.
* **Reversão:** as duas reversões foram testadas em ciclo completo: reverter, conferir e reinstalar.

## 1. Revisão do SQL

| Arquivo | O que faz | Toca dados existentes? |
|---|---|---|
| 0235 (172 linhas) | Cria `rtc_webhook_recebido` (RLS, sem policy, nenhum acesso para anon/authenticated). Troca `rtc_apuracao_receber_tiquete(text,jsonb)` por `(text,jsonb,jsonb default null)` (drop + create na mesma transação). Muda a janela de 2 h para 24 h em `receber_tiquete` e `expirar_pendentes`. As permissões são reemitidas só para service_role. | Não. Só redefine funções. `expirar_pendentes` não é executada. |
| 0240 (868 linhas) | 16 tabelas novas, 16 tipos, 2 domínios, 15 funções, 11 gatilhos de imutabilidade, 16 policies de leitura, revogação explícita de anon/authenticated, 2 buckets privados, 4 policies de Storage, 6 linhas no catálogo `tax_sources`. | Não. Só cria. Os únicos INSERTs são em tabelas novas e os 2 buckets. |
| 0241 (490 linhas) | 7 funções de importação (`security definer`, `search_path` fixo, papel conferido a cada chamada, entrada revalidada no banco). | Não. |

* O arquivo 0235 é **idêntico** em `main`, PR #2 e PR #1 (diff vazio).
* O 0240/0241 não usa `regime_from_registry`, `cnpj_registry` nem `counterparties.regime` (a regra "não optante = Presumido").

## 2. Compatibilidade com o TechIVA-Prod (consultas somente leitura, 17/11, 21h45 UTC)

| Dependência usada | Encontrado no TechIVA-Prod | Situação |
|---|---|---|
| `has_role(uuid, member_role[])` | existe, security definer | OK (só chamada dentro de funções definer) |
| `role_in(uuid)`, `auth_scopes()`, `in_scope(uuid)` | existem | OK |
| `log_audit` com 6 argumentos | `log_audit(uuid,text,text,text,jsonb,jsonb, p_rule uuid DEFAULT NULL)` | OK (7º tem padrão) |
| `member_role` | platform_admin, platform_ops, platform_risk, channel_admin, channel_analyst, owner, finance, commercial, viewer | OK (todos os usados existem) |
| `tenant_kind` / `tenant_status` | platform, channel, company, unit / active, suspended, archived | OK |
| `tenants.path` (ltree), `memberships(user_id, tenant_id, role)` | existem | OK |
| `rtc_apuracao` (id, webhook_ref, status, solicitado_em, tenant_id) | existem; gatilho `rtc_apuracao_substituir_competencia_trg` já existia com a função antiga | OK |
| Colisão de nomes `tax_*` | só existe `tax_cash_events` (e partições), nome diferente; nenhuma função, tipo ou policy `tax_*` do módulo | OK |
| Buckets | avatars, dfe-raw, dfe-secrets | OK (tax-imports e tax-evidences não existem) |
| Storage | `storage.objects` pertence a `supabase_storage_admin` | As 4 policies foram criadas sem erro na pré-visualização hospedada, com o mesmo dono |
| Extensões | pgcrypto e ltree no schema extensions; sem pg_cron | OK (`gen_random_uuid` e `hashtextextended` são nativos do PG 17) |
| Limite de tempo | authenticated 8 s, anon 3 s | A finalização roda em trechos de 10 mil linhas por chamada |
| Apurações `solicitada` | 4, todas com mais de 24 h (27 a 91 dias) | A troca para 24 h não muda o resultado de nenhuma linha atual |

**Privilégios padrão do TechIVA-Prod (drift já conhecido):** o papel `postgres` concede automaticamente:

* ALL em tabela nova para authenticated;
* EXECUTE em função nova para authenticated;
* USAGE/SELECT/UPDATE em sequência nova para authenticated.

As migrations revogam explicitamente o que não deve ficar com authenticated, nas tabelas, nas funções internas e na sequência `tax_audit_logs_id_seq`.

**A pré-visualização do PR #1 passou na verificação pós-migration completa.** Ela é um projeto Supabase hospedado com as 3 migrations aplicadas. O script é o `verificacao-pos-migration.sql`, e todos os 16 itens bateram com o esperado.

## 3. Backup lógico independente

Não consigo gerar nem ler o backup daqui, porque a sandbox não alcança `*.supabase.co`. Então ainda **não há evidência de integridade**. Procedimento:

1. No painel do projeto, em **Connect → Session pooler**, copie a URI.
2. Na sua máquina, com `pg_dump` 17:
   ```bash
   pg_dump "<URI do session pooler>" -Fc -f techiva-prod-2026-11-17.dump
   pg_restore --list techiva-prod-2026-11-17.dump > /dev/null && echo LISTA_OK
   sha256sum techiva-prod-2026-11-17.dump
   ```
3. Envie o `.dump` aqui. O banco tem 95 MB, com poucas centenas de linhas.
4. Eu restauro num Postgres 17 isolado e comparo a contagem de cada tabela com a "impressão digital" do TechIVA-Prod (`evidencias/revisao-final/impressao-digital-prod.txt`). A impressão é tirada de novo, só lendo, no momento em que você enviar o arquivo.
5. Se você preferir não enviar o arquivo, eu passo os comandos de restauração e de contagem para você rodar.

O `pg_dump` não inclui os arquivos do Storage (26 objetos). As migrations não mexem neles.

## 4. Reversão: o que volta e o que não volta

| Script | Testado | Volta | Não volta sem perda |
|---|---|---|---|
| `rollback-0235.sql` | Ciclo completo no banco local: as funções voltam com a ACL igual à atual do TechIVA-Prod (postgres, service_role) e a versão sai do histórico. A 0235 reaplica sem erro. | As duas funções exatamente como estão hoje. | Nada se perde. A tabela `rtc_webhook_recebido` é mantida de propósito, com o que a Receita mandar. Efeito colateral: o retorno da Receita volta a falhar com o código atual da `main`, que já chama `p_meta`. |
| `rollback-0240-0241.sql` | Ciclo completo no banco local com 60.656 linhas sintéticas. Objetos fora do módulo: 436 antes e 436 depois. Funções fora do módulo: 158 e 158. Policies fora do módulo: 65 e 65. A reinstalação reconstrói tudo. | Todo o catálogo do módulo. | Os **dados do módulo** gravados depois da implantação (importações, carteira, evidências, `tax_audit_logs`), que são apagados: é preciso fazer o dump dessas tabelas antes. **Arquivos nos buckets**: o script trava se houver arquivos, e eles só saem pela API do Storage. **Os 2 buckets** não são apagáveis por SQL (o Storage recusa) e ficam vazios e privados até serem removidos pelo painel. |
| Restauração do backup diário ou PITR | Não testada (é operação do painel) | O banco inteiro até o ponto escolhido. | **Tudo o que o app inteiro gravou depois desse ponto**, e não só o módulo. Por isso é o último recurso. |

**Como o CLI aplica os arquivos:** o teste com o Supabase CLI 2.122.1 está em `evidencias/revisao-final/teste-transacao-cli.txt`.

* Cada arquivo é tudo ou nada, incluindo o registro no histórico.
* Se o 2º ou o 3º arquivo falhar, os anteriores ficam aplicados.

Os estados parciais possíveis são "só 0235" ou "0235 + 0240", e os dois são consistentes por si. Basta corrigir e rodar `db push` de novo.

## 5. PR #3 (0250)

* O PR #3 está aberto, em rascunho e sem merge.
* O TechIVA-Prod termina em `20260923200000` (138 versões), então a 0250 não está aplicada.
* O dry-run oficial não listou a 0250, porque o arquivo não está no clone de PR #2 + PR #1.
* A 0250 não toca nenhum objeto da 0235, da 0240 ou da 0241. Ela mexe em índices de outras tabelas, nas policies de profiles e memberships, e em `audit_overview`.

**Regra:** o merge do PR #3 só acontece depois de 0235/0240/0241 aplicadas e dos merges do PR #2 e do PR #1. Se a 0250 entrasse antes, a 0235 e a 0241 ficariam com versão anterior à última aplicada e só entrariam com `--include-all`, que é proibido.

## 6. Plano de execução (só depois da sua autorização expressa)

1. **Pré-condições:** backup lógico validado, PITR ou backup diário confirmado, Deploy to production desligado e PR #3 sem merge.
2. Eu tiro, só lendo, a impressão digital do TechIVA-Prod imediatamente antes.
3. No mesmo clone do dry-run:
   ```bash
   supabase db push --dry-run   # de novo: precisa listar só 0235, 0240, 0241
   supabase db push             # sem --include-all
   ```
   Escolha um horário sem uso do app. A 0240 pega trava curta em `tenants` (FK) e em `storage.objects` (policies).
4. Cole aqui a saída completa. Eu rodo a verificação, só lendo:
   * `verificacao-pos-migration.sql`, com 17 itens e o esperado ao lado (o histórico deve dar 141);
   * as contagens das tabelas existentes contra a impressão digital (iguais, salvo sessões e tokens de login);
   * os advisors de segurança do Supabase.
5. Se algum item divergir, eu paro, mostro a divergência e proponho corrigir ou reverter com o script testado. Nada é feito sem sua decisão.
6. Depois, também com autorização própria: merge do PR #2, merge do PR #1 (lock de dependências resolvido), publicação e validação no app publicado.

## Riscos remanescentes

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| 1 | Backup lógico ainda não validado | — | Alto se precisar restaurar | Bloqueante: seção 3 |
| 2 | Deploy to production e PITR não confirmados por mim (não há ferramenta) | — | Alto | Bloqueante: confirmação no painel |
| 3 | Finalização de 10 mil linhas passar de 8 s no compute Micro (1 GB) do TechIVA-Prod; local e pré-visualização ficaram abaixo | Média | Importação grande para com erro, sem dado corrompido (cada trecho é transação, retomável) | Piloto com arquivo pequeno primeiro; se estourar, migration nova reduzindo o trecho |
| 4 | Diferença de versão: pré-visualização em PG 17.12, TechIVA-Prod em 17.6 | Baixa | Falha na aplicação, sem efeito parcial no arquivo | Nada usado é exclusivo de 17.12; o arquivo é atômico |
| 5 | Sequência nova `rtc_webhook_recebido_id_seq` herda USAGE/UPDATE para authenticated pelo privilégio padrão (mesmo caso das 6 sequências que já existem no TechIVA-Prod) | Muito baixa | Só por conexão direta ao banco, que usuários do app não têm; a API não expõe `setval` | Migration de limpeza de privilégios padrão, em autorização separada |
| 6 | `tax_audit` converte o `x-forwarded-for` para `inet`; um valor fora do formato faria a chamada falhar | Baixa | A RPC de importação retorna erro | Validar no piloto; endurecer numa migration seguinte |
| 7 | Trava curta em `tenants` e `storage.objects` durante a 0240 | Baixa | Requisições esperam alguns ms | Horário sem uso |
| 8 | Main com status MIGRATIONS_FAILED no Supabase desde 17/08 (duplicatas que o PR #2 remove) | — | Se o Deploy to production estiver ligado, o merge pode tentar aplicar | Coberto pelo item 2 e pela ordem PR #2 → PR #1 |

Ponto a favor de aplicar: hoje o código publicado na `main` chama `rtc_apuracao_receber_tiquete` com `p_meta`, que não existe no TechIVA-Prod. Qualquer retorno real da Receita falha até a 0235 entrar.
