# Diagnóstico do histórico de migrations e plano de regularização

Levantamento de 17/11/2026. **Nada foi alterado no fluxa-dev** (`lfufwoirpwlsdmststbr`):
só houve consultas de leitura ao catálogo e à tabela `supabase_migrations.schema_migrations`.
O PR #1 continua sem merge, e as migrations 0240 e 0241 continuam sem aplicação no banco
principal. Os passos da seção 6 são uma proposta e dependem de autorização.

## 1. Resumo

| Situação | Quantidade | Risco |
| --- | --- | --- |
| Migration do repositório com o mesmo conteúdo registrado no fluxa-dev | 133 | nenhum |
| Registrada no fluxa-dev **sem o texto** do SQL (0230 a 0234), mas com os objetos iguais aos do repositório | 5 | baixo |
| Arquivo duplicado: o mesmo conteúdo já aplicado com outra versão | 2 | **alto**: uma delas falha se for executada |
| Pendente e fora do módulo tributário (0235, apuração RTC) | 1 | **alto**: o código da `main` já depende dela |
| Pendente e deste projeto (0240 e 0241) | 2 | baixo: objetos novos, sem colisão |
| Versão registrada no fluxa-dev sem arquivo no repositório | 0 | — |

Além disso, o fluxa-dev tem mudanças feitas **fora de migrations** (privilégios, RLS e uma
política), que um banco novo montado a partir do repositório não reproduz (seção 4).

Como foi comparado: o texto de cada migration registrada no fluxa-dev e o de cada arquivo
foram normalizados (sem comentários `--` e sem espaços) e comparados por MD5. As funções
foram comparadas pelo corpo (`prosrc`) com a mesma normalização.

## 2. Divergências entre o repositório e o histórico

### 2.1 Duplicadas: mesmo nome, outra versão

| Arquivo só no repositório | Versão aplicada no fluxa-dev | Diferença real | Se for executado no fluxa-dev |
| --- | --- | --- | --- |
| `20260818200000_split_premissas_antecipacao.sql` | `20260818173625` | formatação, o texto de uma mensagem de erro e duas variáveis não usadas num bloco de teste | **falha** com `project_cash_sql: nenhuma substituição aplicada`, porque ele reescreve uma função que a versão aplicada já reescreveu. Confirmado na pré-visualização. |
| `20260820150000_dfe_distribuicao_estado_e_cofre.sql` | `20260820123740` | só comentários | não muda nada: tudo é `if not exists`, `on conflict do nothing` ou tolera objeto existente |

Origem: o README de `supabase/migrations/` manda aplicar por MCP (`apply_migration`) e
commitar o mesmo texto. O MCP grava a migration com a hora da aplicação como versão, e o
arquivo commitado recebeu outra hora. O commit `c96e6c6` (16/09) trouxe as versões do banco
para o repositório, mas os arquivos antigos ficaram.

### 2.2 Registradas sem o texto (0230 a 0234)

`20260916173820` (0230), `20260917120000` (0231), `20260923180000` (0232), `20260923190000`
(0233) e `20260923200000` (0234) estão no histórico do fluxa-dev com `statements` vazio, o
que indica registro manual (por exemplo, `supabase migration repair`) depois de aplicar o SQL
por fora. Conferi os objetos que elas criam:

| Objeto | fluxa-dev × repositório |
| --- | --- |
| `rtc_apuracao.historico` (coluna e comentário) | existe, igual |
| `rtc_apuracao_registrar_diag` | corpo igual |
| `rtc_apuracao_pendentes_download` | corpo igual |
| `conciliacao_documentos` e `conciliacao_documentos_page` | corpo igual |
| `apuracao_divergencia` | corpo igual |
| `rtc_apuracao_ingest_json` | corpo igual |

Conclusão: estão aplicadas de fato. Não precisam de ação. O Supabase CLI considera a
versão registrada, então não vai reexecutá-las.

### 2.3 Pendentes no fluxa-dev

| Versão | Do que se trata | Estado no fluxa-dev |
| --- | --- | --- |
| `20260926030000` (0235) | apuração RTC: registra todo retorno da Receita e sobe a janela para 24 h | ausente: não há `rtc_webhook_recebido`, e `rtc_apuracao_receber_tiquete` tem 2 parâmetros (`p_ref`, `p_payload`) |
| `20261117200000` (0240) | Inteligência Tributária, fundação | ausente (correto) |
| `20261117200100` (0241) | Inteligência Tributária, importação | ausente (correto) |

**Atenção sobre a 0235, fora deste módulo.** A `main` já tem, desde 25/09 (commit `7db885c`),
o código que chama `rtc_apuracao_receber_tiquete` com o terceiro parâmetro `p_meta`
(`src/routes/api/public/rtc.apuracao.$ref.tsx`, linha 69). O cabeçalho da 0235 diz que ela
deve ser aplicada **antes** de publicar esse código. Se a versão publicada do app já tiver
esse commit, o endereço de retorno da Receita deve estar falhando ao chamar a função. Não
consegui confirmar isso: os logs do Supabase das últimas 24 h não mostram nenhuma chamada a
essa função, e não tenho acesso aos logs do app publicado.

## 3. Por que nada foi aplicado sozinho até agora

A integração Supabase ↔ GitHub do fluxa-dev aplica migrations novas na produção quando a
opção **Deploy to production** está ligada e algo é enviado para a `main`. Três fatos
indicam que isso não acontece desde agosto:

* a branch `main` no Supabase está em `MIGRATIONS_FAILED`, sem atualização desde 17/08/2026;
* a 0235 está na `main` desde 25/09 e não foi aplicada;
* os dois arquivos duplicados estão na `main` desde 16/09 e também não foram executados.

Pelo que está visível, ou a opção está desligada, ou a implantação está travada desde 17/08.
Não consigo ler essa configuração daqui. Por isso o plano começa conferindo e desligando a
opção, antes de qualquer merge. Se ela estiver ligada e voltar a funcionar, um merge na `main`
tentaria aplicar, em ordem, as 5 pendentes: a duplicada `split_premissas` falharia, e o
resultado dependeria de como o Supabase trata a falha.

## 4. O que existe no fluxa-dev e não vem das migrations

Comparação entre o fluxa-dev e a pré-visualização, que foi montada só com as migrations do
repositório:

| Item | fluxa-dev | Banco montado pelas migrations |
| --- | --- | --- |
| Funções do schema `public` fora do módulo (156) | iguais | iguais |
| Colunas das tabelas fora do módulo (551) | iguais | iguais |
| RLS em `calc_classtrib_aplicavel` e `calc_classtrib_matriz` | **ligado** | desligado |
| Políticas `audit_findings_read` e `audit_findings_update` | uma versão | outra (papéis ou `with check` diferentes) |
| Privilégios de `authenticated` nas tabelas | INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES e TRIGGER em cerca de 40 tabelas | quase só SELECT |
| Privilégios padrão do papel `postgres` no `public` | tabelas, sequências e funções novas nascem com acesso para `authenticated` | só parte disso |
| Usuário de seed `admin@fluxa.dev` (senha fixa no repositório, papel `platform_admin`) | não existe | **existe** em todo banco novo, inclusive na pré-visualização |

O RLS continua barrando INSERT, UPDATE e DELETE nas tabelas sem política de escrita, então
os privilégios largos não abrem acesso pela API. Mesmo assim, é uma camada de proteção a
menos, e um banco novo não fica igual à produção. Proponho não mexer nisso agora: registrar,
e decidir depois se o caminho é endurecer a produção ou criar uma migration de base que
reproduza o estado atual.

**Efeito sobre o módulo tributário: nenhum.** As migrations 0240 e 0241 revogam tudo de
`anon` e `authenticated` em cada tabela, sequência e função interna, e concedem só o
necessário. Para provar isso, a suíte SQL agora roda com os mesmos privilégios padrão do
fluxa-dev (seção 5).

## 5. Validação da Fase 1

### 5.1 Instalação num ambiente limpo

| Ambiente | Resultado |
| --- | --- |
| Postgres 16 descartável, com as funções de escopo copiadas do fluxa-dev e os **privilégios padrão iguais aos do fluxa-dev** | 0240 e 0241 instalam sem erro, e a suíte passa com **253 de 253** |
| Pré-visualização do Supabase (Postgres 17.12), criada vazia e montada pelas 143 migrations do repositório | 0240 e 0241 instalam sem erro. Os dados de apoio foram necessários só para migrations antigas, nenhum para a 0240 ou a 0241 |
| fluxa-dev | Postgres 17.6 (consultado), sem nenhuma colisão de nome: nenhuma tabela, tipo, função, bucket ou política com os nomes do módulo |

As funções existentes que o módulo usa (`auth_scopes`, `in_scope`, `role_in`, `has_role` e
`log_audit`) têm o corpo **idêntico** no fluxa-dev e nos stubs da suíte (MD5 igual nas 5).

### 5.2 Instalar, reverter e instalar de novo

Num Postgres descartável, com os privilégios padrão do fluxa-dev:

1. catálogo antes: 202 objetos;
2. instalação da 0240 e da 0241: 352 objetos;
3. reversão com [`rollback-0240-0241.sql`](rollback-0240-0241.sql): 202 objetos, **idêntico** ao
   catálogo de antes (tabelas, funções, tipos, políticas, gatilhos, buckets e privilégios);
4. nova instalação da 0240 e da 0241: sem erro, catálogo igual ao do passo 2.

O script de reversão não é migration, não fica em `supabase/migrations/` e só roda com
autorização. Ele recusa seguir se houver arquivos nos buckets do módulo.

### 5.3 A aplicação depois das migrations

| Verificação | Resultado |
| --- | --- |
| `vite build` (build de produção) | sem erro |
| `tsc --noEmit` e `vitest` (157 testes) | sem erro na entrega da Fase 1. Nenhum arquivo de `src/` mudou desde então |
| Funções e colunas existentes depois da 0240 e da 0241 (pré-visualização × fluxa-dev) | 156 funções e 551 colunas iguais, ou seja, o módulo não alterou nada existente |
| Teste de fumaça das RPCs na pré-visualização | ver `pre-visualizacao.md`, seção 3.2 |
| Abrir a tela no navegador contra a pré-visualização | **não feito**: este ambiente não alcança `*.supabase.co` (bloqueio de rede do proxy) |

### 5.4 Reprodutibilidade da importação

Duas execuções seguidas da suíte completa (70 mil linhas), num banco recriado do zero a cada
vez: 253 de 253 nas duas, com a **mesma lista** de testes aprovados e as mesmas contagens
(700 CNPJs inválidos, 699 repetições, 68.601 válidos). Só os tempos variam. A suíte foi
corrigida para também funcionar com cargas menores (`TAX_LOAD_ROWS=2500`): antes, um teste
supunha mais de 10 mil linhas.

**Correção de uma afirmação anterior.** A documentação dizia que o workflow
`Inteligência Tributária · SQL` roda em todo PR. Ele nunca rodou no PR #1: o GitHub não
registrou nenhuma execução de Actions nesta branch, nem deste workflow nem do `Verificação`
já existente. A evidência da suíte é local. Vale olhar a aba Actions do repositório para ver
se há execuções aguardando aprovação.

### 5.5 Dependências das migrations 0240 e 0241

Todas existem no fluxa-dev com a definição esperada:

* funções: `auth.uid()`, `auth_scopes()`, `in_scope(uuid)`, `has_role(uuid, member_role[])`,
  `log_audit(...)` (7 parâmetros) e `gen_random_uuid()`;
* tabelas: `tenants` (colunas `id`, `kind` e `path`), `memberships` (`user_id` e
  `tenant_id`), `audit_log` (via `log_audit`), `storage.objects` e `storage.buckets`;
* tipo `member_role`, com os valores `platform_admin`, `platform_ops`, `platform_risk`,
  `channel_admin`, `owner` e `finance`;
* `tenants.kind = 'platform'`;
* extensão `ltree` no schema `extensions`, que está no `search_path` das funções;
* `statement_timeout` de 8 s no papel `authenticated` (por isso a finalização é em trechos).

Não dependem da 0235, nem de nenhuma das duplicadas. Também não alteram nenhum objeto
existente: as únicas escritas fora do módulo são 2 linhas em `storage.buckets` e 4 políticas
novas em `storage.objects`.

## 6. Plano de regularização (proposta, nada executado)

Princípios: nada é reexecutado no fluxa-dev, nenhuma migration já aplicada é alterada, e cada
etapa que toca o banco principal tem autorização própria, verificação antes e depois e um
jeito de voltar.

### Etapa 0. Preparação, sem mudar o banco

1. No painel do Supabase, em *Project Settings → Integrations → GitHub*, conferir a opção
   **Deploy to production** e **desligá-la** até o fim da regularização. Isso evita que
   qualquer merge na `main` aplique migrations sozinho. Volta-se a ligar no mesmo lugar.
2. Ver o log da implantação da branch `main` (em *Branches*) para saber o erro de 17/08.
3. Confirmar que há backup recente (*Database → Backups*) e, se o plano tiver, PITR.
4. Na sua máquina, com o Supabase CLI e a senha do banco, fotografar o estado atual. Todos
   estes comandos são só de leitura:

   ```bash
   supabase link --project-ref lfufwoirpwlsdmststbr
   supabase migration list                 # repositório × banco, versão a versão
   supabase db dump --schema-only -f fluxa-dev-schema-$(date +%Y%m%d).sql
   supabase db dump --data-only --schema supabase_migrations -f fluxa-dev-historico-$(date +%Y%m%d).sql
   supabase db push --dry-run              # lista o que seria aplicado, sem aplicar
   ```

   O esperado no `--dry-run` hoje são as 5 pendentes da seção 2. É provável que o CLI recuse
   listar as duas duplicadas e a 0235 sem `--include-all`, porque elas têm versão anterior
   à última registrada. **Não use `--include-all` no fluxa-dev.**

### Etapa 1. Corrigir só o repositório (PR separado, sem tocar no banco)

1. Tirar de `supabase/migrations/` os dois arquivos duplicados e guardá-los em
   `docs/historico-migrations/` com extensão `.sql.txt`, para que nenhuma ferramenta os
   execute. O conteúdo deles já está no banco pelas versões `20260818173625` e
   `20260820123740` (seção 2.1).
2. Atualizar o README de `supabase/migrations/`: migration nova entra **só** como arquivo no
   repositório e é aplicada pelo CLI (`supabase db push`), que grava a versão do próprio
   arquivo. Nada de `apply_migration` pelo MCP, que grava outra versão e gerou as duplicatas.
3. Não alterar as migrations antigas que dependem de registros que só existem no fluxa-dev
   (`20260817192810` e `20260817211332`). Elas só atrapalham bancos novos, e a pré-visualização
   já contorna isso com dados de apoio. Se mais adiante você quiser bancos novos sem esse
   contorno, a correção é acrescentar uma condição "só se o registro existir". O Supabase
   identifica migration pela versão, então o fluxa-dev não reexecutaria nada, mas o texto
   deixaria de bater com o registrado lá. Fica para decisão sua.
4. Validar numa pré-visualização nova: o `--dry-run` passa a listar só a 0235, a 0240 e a 0241.

Risco: nenhum no banco. Se o *Deploy to production* estiver ligado por engano no merge, a
única pendente nova seria a 0235, aplicada sem controle. Por isso a Etapa 0 vem antes.

### Etapa 2. Aplicar a 0235 (autorização própria, módulo de apuração RTC)

Ela é independente do módulo tributário, mas vem antes na ordem de versões, e o código da
`main` depende dela.

1. Antes: confirmar qual commit está publicado no app e se o retorno da Receita está falhando.
2. Aplicar só ela:

   ```bash
   supabase db push --dry-run   # deve listar só 20260926030000 (e 0240/0241, se estiverem na branch)
   supabase db push
   ```

   Se for feito a partir da `main`, onde a 0240 e a 0241 ainda não estão, só a 0235 entra.
3. Depois: `rtc_webhook_recebido` existe, e `rtc_apuracao_receber_tiquete` tem 3 parâmetros.
4. Para voltar: recriar a função de 2 parâmetros a partir do dump da Etapa 0 e apagar a
   tabela nova, que só guarda registros de chamadas.

### Etapa 3. Aplicar a 0240 e a 0241 (autorização própria)

1. A partir da branch do PR #1, ainda sem merge: `supabase db push --dry-run` deve listar
   **exatamente** `20261117200000` e `20261117200100`. Se aparecer qualquer outra, parar.
2. `supabase db push`.
3. Depois, as mesmas verificações já feitas na pré-visualização: RLS nas 16 tabelas, nenhum
   privilégio de escrita para `authenticated`, nada para `anon`, buckets privados, 4 políticas
   de Storage, funções internas fechadas e `supabase migration list` com repositório e banco
   iguais.
4. Só então fazer o merge do PR #1 e publicar o app. Assim a tela nova nunca vai ao ar sem as
   tabelas.
5. Para voltar: `rollback-0240-0241.sql`, testado na seção 5.2. Ele apaga os dados do módulo,
   então, se já houver importações, faça antes um dump das tabelas `tax_*`.

### Etapa 4. Depois da regularização

* Decidir se o *Deploy to production* volta a ser ligado. Com o histórico alinhado, um merge
  só aplicaria migrations novas.
* Decidir o que fazer com as diferenças da seção 4 (privilégios largos, RLS e políticas fora
  das migrations, usuário de seed em bancos novos).

## 7. Riscos e como cada um é evitado

| Risco | Como é evitado |
| --- | --- |
| Merge na `main` aplicar migrations sem controle | Etapa 0, item 1, antes de qualquer merge |
| Reexecutar a duplicada `split_premissas` (falha) | Etapa 1 tira o arquivo de `supabase/migrations/` |
| Reexecutar a duplicada `dfe_distribuicao` | idem. Mesmo se rodasse, não mudaria nada |
| Aplicar migrations antigas fora de ordem | nunca usar `--include-all` no fluxa-dev, e sempre ler o `--dry-run` antes |
| Publicar a tela nova antes das tabelas | merge e publicação só depois da Etapa 3 |
| 0240/0241 abrirem acesso por causa dos privilégios padrão do fluxa-dev | testado com os mesmos privilégios: 253 de 253 |
| Precisar desfazer a 0240/0241 | script de reversão testado: o catálogo volta igual ao de antes |
| Perder o estado atual | dump de schema e de histórico na Etapa 0, além do backup do Supabase |

## 8. O que não foi possível verificar daqui

* A configuração *Deploy to production* e o log da falha de 17/08: só pelo painel.
* Se o app publicado já está com o código que depende da 0235.
* A tela aberta num navegador contra um banco com o módulo: este ambiente não alcança
  `*.supabase.co`. Dá para fazer na sua máquina apontando o `.env` para a pré-visualização.
* Comandos do Supabase CLI contra o fluxa-dev: exigem a senha do banco, que não está aqui.
