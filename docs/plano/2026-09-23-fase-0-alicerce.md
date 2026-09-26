# Fase 0 — Alicerce: plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** deixar o sistema confiável de mexer — verificação automática a cada envio, publicação sem esquecimento, nenhum número inventado nos caminhos de dinheiro, e um experimento seguro para destravar a integração com a Receita.

**Arquitetura:** regras de decisão viram funções puras com teste (padrão já usado em `src/lib/rtc-v2/`); o servidor e o banco só aplicam essas regras. Nenhuma mudança visual além de mover dois textos para o balão de ajuda.

**Tecnologia:** TanStack Start + React + TypeScript, Supabase/Postgres, vitest. Bun no lockfile (o CI usa Bun; localmente os binários estão em `node_modules/.bin`).

**Roteiro de onde isto vem:** [2026-09-23-roteiro-produto.md](2026-09-23-roteiro-produto.md)

## Regras globais (valem para toda tarefa)

- **Nenhum número chega à tela sem vir do motor oficial.** Resposta que não se entende = erro explícito, nunca zero.
- **Ausente não é zero.** Valor desconhecido é `null` no dado e "—" na tela.
- Migração nova vai em `supabase/migrations/AAAAMMDDHHMMSS_NNNN_descricao.sql`. Nunca em `db/migrations/` (ver `db/migrations/LEIA-ME.md`).
- Mudar a lista de colunas devolvida por uma função do banco exige `drop function` antes do `create` (senão: SQLSTATE 42P13), e o `drop` apaga as permissões — reemitir **as mesmas** que existiam.
- O assistente **não** consegue aplicar migração em produção (bloqueio automático). Toda migração termina com um arquivo para o usuário colar no SQL Editor do Supabase, incluindo o registro em `supabase_migrations.schema_migrations`.
- `exactOptionalPropertyTypes` está ligado: campo opcional se omite, nunca se atribui `undefined`.
- Não instalar dependência (`npm install`, `bun add`): o projeto usa `bun.lock`, e `npm install` cria um `package-lock.json` intruso.
- Não reescrever histórico publicado (`push --force`, `rebase`/`amend` de commit já enviado) — o branch é ligado ao Lovable.
- Todo commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Textos para o usuário: português claro, sem jargão.

## Mapa de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `src/routes/_authenticated/t.$tenantId.apuracao.tsx` | 1 | explicação vai para a prop `help` do Panel |
| `src/routes/_authenticated/t.$tenantId.price.tsx` | 1 | explicação do piso vai para `<InfoHint>` |
| `.github/workflows/verificacao.yml` (novo) | 2 | tipos + testes a cada envio |
| `scripts/pronto-para-publicar.sh` (novo) | 3 | checagem antes de clicar em Publicar |
| `docs/fluxo-de-trabalho.md` (novo) | 3 | como publicar sem perder alteração |
| `src/lib/rtc-v2/espera.ts` + teste (novos) | 4 | regra pura: cedo demais para baixar? |
| `src/lib/rtc-apuracao.server.ts` | 4 | aplica a espera antes de tocar no tíquete |
| `supabase/migrations/20260923180000_0232_conciliacao_ausente_nao_e_zero.sql` (novo) | 5 | banco para de transformar "sem nota" em zero |
| `src/lib/conciliacao-motivo.ts` + teste (novos) | 5 | regra pura do motivo da divergência |
| `src/lib/rtc.ts` | 5 | tipo ganha `tem_correspondente`; reexporta o motivo |
| `src/components/techiva/conciliacao.tsx` | 5 | mostra "—" para valor desconhecido; semáforo deixa de acender vermelho para nota imune |
| `docs/auditoria/2026-09-23-zeros-por-falta.md` (novo) | 6 | classificação de cada `?? 0` em caminho de dinheiro |

---

### Tarefa 1: Suíte de testes verde

Hoje 82 de 83 testes passam. O que falha é a regra visual do produto: texto
explicativo com mais de 90 caracteres fora do balão "?". Dois lugares.
Sem a suíte verde, a verificação automática da Tarefa 2 nasceria vermelha e
ninguém mais olharia para ela.

**Arquivos:**
- Modificar: `src/routes/_authenticated/t.$tenantId.apuracao.tsx` (bloco perto da linha 339)
- Modificar: `src/routes/_authenticated/t.$tenantId.price.tsx` (bloco perto da linha 555)
- Teste existente: `scripts/visual-guard/prose-guard.test.ts`

**Interfaces:**
- Consome: `Panel` (`src/components/techiva/page.tsx`, prop `help?: ReactNode`) e `InfoHint` (`src/components/techiva/info-hint.tsx`, props `title?: string`, `children: ReactNode`). `price.tsx` já importa `InfoHint` (linha 7).
- Produz: nada para outras tarefas.

- [ ] **Passo 1: Confirmar a falha**

Rodar: `./node_modules/.bin/vitest run scripts/visual-guard`
Esperado: FALHA listando `t.$tenantId.apuracao.tsx:342` e `t.$tenantId.price.tsx:556`.

- [ ] **Passo 2: Apuração — mover a explicação para `help` do Panel**

Trocar este trecho:

```tsx
          <Panel title="Apuração ainda não consultada" icon={Info}>
            <p className="text-sm text-muted-foreground">{naoConsultadaMsg}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              A Receita responde de forma assíncrona: ao consultar, a estrutura completa da apuração
              e a comparação com o seu cálculo aparecem aqui.
            </p>
            <div className="mt-4">{consultarReceita}</div>
          </Panel>
```

por:

```tsx
          <Panel
            title="Apuração ainda não consultada"
            icon={Info}
            help={
              <p>
                A Receita responde de forma assíncrona: ao consultar, a estrutura completa da
                apuração e a comparação com o seu cálculo aparecem aqui.
              </p>
            }
          >
            <p className="text-sm text-muted-foreground">{naoConsultadaMsg}</p>
            <div className="mt-4">{consultarReceita}</div>
          </Panel>
```

- [ ] **Passo 3: Preço — mover a explicação do piso para `<InfoHint>`**

Trocar:

```tsx
                    <p className="mt-3 text-xs text-muted-foreground">
                      Piso = custo líquido do crédito na entrada, recomposto pela alíquota do ano e
                      pelas despesas variáveis. O alvo aplica a margem sobre esse piso.
                    </p>
```

por:

```tsx
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Como o piso é calculado</span>
                      <InfoHint title="Piso e alvo">
                        <p>
                          Piso = custo líquido do crédito na entrada, recomposto pela alíquota do
                          ano e pelas despesas variáveis. O alvo aplica a margem sobre esse piso.
                        </p>
                      </InfoHint>
                    </div>
```

- [ ] **Passo 4: Rodar a regra visual e a suíte inteira**

Rodar: `./node_modules/.bin/vitest run scripts/visual-guard`
Esperado: PASSA.

Rodar: `./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vitest run`
Esperado: tipos sem erro; **83 de 83** testes passando.

Se a regra visual ainda acusar algum dos dois arquivos, ler a mensagem: ela diz a linha e o texto. Não aumentar `MAX_INLINE_CHARS` — a regra é do produto.

- [ ] **Passo 5: Commit**

```bash
git add "src/routes/_authenticated/t.\$tenantId.apuracao.tsx" "src/routes/_authenticated/t.\$tenantId.price.tsx"
git commit -m "Move duas explicacoes para o balao de ajuda e deixa a suite verde

A regra visual do produto (explicacao so no balao '?') falhava em apuracao.tsx
e price.tsx. Com a suite vermelha, a verificacao automatica nasceria vermelha e
seria ignorada.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: Verificação automática a cada envio

Hoje os testes só rodam quando alguém lembra. E o Lovable envia código direto
para a principal — nada impede uma edição automática de desfazer uma correção.
Esta tarefa faz o GitHub rodar tipos e testes em todo envio, inclusive nos do
Lovable.

**Arquivos:**
- Criar: `.github/workflows/verificacao.yml`

**Interfaces:**
- Consome: suíte verde da Tarefa 1.
- Produz: status verde/vermelho em cada commit no GitHub.

- [ ] **Passo 1: Criar o workflow**

```yaml
name: Verificação

# Roda em todo envio para a principal — inclusive os commits automáticos do
# Lovable, que hoje não passam por verificação nenhuma — e em pull request.
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verificar:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      # O projeto trava versões em bun.lock; usar npm aqui criaria outra árvore.
      - uses: oven-sh/setup-bun@v2

      - name: Instalar dependências (versões travadas)
        run: bun install --frozen-lockfile

      - name: Tipos
        run: bunx tsc --noEmit -p tsconfig.json

      - name: Testes
        run: bunx vitest run
```

- [ ] **Passo 2: Enviar e observar a primeira execução**

```bash
git add .github/workflows/verificacao.yml
git commit -m "Verificacao automatica de tipos e testes a cada envio

Os testes so rodavam quando alguem lembrava, e o Lovable envia direto para a
principal. Agora todo envio — inclusive os automaticos — passa por tipos e testes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

Conferir o resultado em `https://github.com/diogoadmgo-source/tech-iva/actions` (ou `gh run list --limit 1`, se o `gh` estiver instalado e autenticado).
Esperado: execução "Verificação" com os três passos verdes.

- [ ] **Passo 3: Se `bun install --frozen-lockfile` falhar**

Significa que `bun.lock` e `package.json` divergem. **Não** remover `--frozen-lockfile` para fazer passar: ler qual pacote diverge, relatar ao usuário, e parar a tarefa. Um lockfile fora de sincronia é achado, não obstáculo.

---

### Tarefa 3: "Pronto para publicar" — nunca mais publicar código que não foi enviado

Em 16/09 seis correções ficaram gravadas só na máquina local; o usuário clicou
em Publicar, subiu a versão antiga, e duas consultas da Receita foram gastas
rodando o defeito já corrigido. Esta tarefa cria uma checagem de um comando
que responde "posso publicar?".

**Arquivos:**
- Criar: `scripts/pronto-para-publicar.sh`
- Criar: `docs/fluxo-de-trabalho.md`

**Interfaces:**
- Consome: nada.
- Produz: comando `bash scripts/pronto-para-publicar.sh`, saída final `PRONTO PARA PUBLICAR` (código 0) ou `NÃO PUBLIQUE AINDA` (código 1).

- [ ] **Passo 1: Criar o script**

```bash
#!/usr/bin/env bash
# Responde uma pergunta só: posso clicar em Publicar no Lovable?
#
# Existe por causa de 16/09/2026: seis correções ficaram gravadas só nesta
# máquina, a publicação subiu a versão antiga, e duas consultas da Receita
# foram gastas rodando um defeito já corrigido.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

falhou=0

echo "1/4 Conferindo o repositório remoto..."
git fetch origin --quiet

if [ -n "$(git status --porcelain)" ]; then
  echo "  ✗ Há alterações nesta máquina que não foram gravadas:"
  git status --short | sed 's/^/      /'
  falhou=1
else
  echo "  ✓ Nada pendente de gravar"
fi

echo "2/4 Conferindo se tudo foi enviado..."
a_enviar=$(git rev-list --count origin/main..HEAD)
a_trazer=$(git rev-list --count HEAD..origin/main)
if [ "$a_enviar" -gt 0 ]; then
  echo "  ✗ $a_enviar alteração(ões) gravada(s) aqui e NÃO enviada(s)."
  echo "      O Lovable não as vê. Envie com: git push origin main"
  falhou=1
else
  echo "  ✓ Tudo o que está gravado aqui foi enviado"
fi
if [ "$a_trazer" -gt 0 ]; then
  echo "  ✗ O remoto tem $a_trazer alteração(ões) que não estão aqui (provavelmente do Lovable)."
  echo "      Traga com: git pull --no-rebase origin main"
  falhou=1
fi

echo "3/4 Conferindo os tipos..."
if ./node_modules/.bin/tsc --noEmit -p tsconfig.json; then
  echo "  ✓ Tipos"
else
  echo "  ✗ Erro de tipos"
  falhou=1
fi

echo "4/4 Rodando os testes..."
if ./node_modules/.bin/vitest run >/tmp/pronto-testes.log 2>&1; then
  echo "  ✓ $(grep -E 'Tests ' /tmp/pronto-testes.log | tail -1 | sed 's/^ *//')"
else
  echo "  ✗ Testes falhando:"
  grep -E 'FAIL|Tests ' /tmp/pronto-testes.log | sed 's/^/      /'
  falhou=1
fi

echo
if [ "$falhou" -eq 0 ]; then
  echo "PRONTO PARA PUBLICAR"
else
  echo "NÃO PUBLIQUE AINDA"
  exit 1
fi
```

- [ ] **Passo 2: Testar os dois lados do script**

Com a árvore limpa e tudo enviado:
Rodar: `bash scripts/pronto-para-publicar.sh`
Esperado: termina em `PRONTO PARA PUBLICAR`, código de saída 0.

Criar um commit local vazio sem enviar, rodar de novo, e desfazer:

```bash
git commit --allow-empty -m "teste local, nao enviar" -q
bash scripts/pronto-para-publicar.sh; echo "codigo: $?"
git reset --soft HEAD~1
```

Esperado: `✗ 1 alteração(ões) gravada(s) aqui e NÃO enviada(s)`, `NÃO PUBLIQUE AINDA`, `codigo: 1`. O `reset --soft` só desfaz o commit vazio, que nunca foi enviado.

- [ ] **Passo 3: Escrever `docs/fluxo-de-trabalho.md`**

```markdown
# Fluxo de trabalho

## Antes de clicar em Publicar

    bash scripts/pronto-para-publicar.sh

Só publique se a última linha for **PRONTO PARA PUBLICAR**.

O motivo: em 16/09/2026 seis correções estavam gravadas só numa máquina.
A publicação subiu a versão antiga e duas consultas da Receita foram gastas
rodando um defeito que já estava corrigido.

## Quem mexe no código

Duas fontes escrevem na mesma branch `main`:

- **O Lovable**, quando você pede algo no editor dele — envia sozinho.
- **Edição local** (Claude Code ou manual) — só chega ao Lovable depois de `git push`.

Por isso: **antes de começar a mexer localmente, traga o que o Lovable fez**
(`git pull --no-rebase origin main`). E não peça ao Lovable para mexer num
arquivo que está sendo mexido localmente ao mesmo tempo — em 16/09 as duas
fontes corrigiram o mesmo defeito no mesmo arquivo, de jeitos diferentes.

## Banco de dados

- Migração nova: `supabase/migrations/AAAAMMDDHHMMSS_NNNN_descricao.sql`.
- `db/migrations/` **não** é a fonte da verdade (ver o LEIA-ME de lá).
- A migração só existe em produção depois de rodada no SQL Editor do Supabase.
  Gravar o arquivo no projeto não aplica nada.

## Verificação automática

Todo envio para a `main` roda tipos e testes no GitHub
(`.github/workflows/verificacao.yml`), inclusive os envios do Lovable.
Se ficar vermelho, **não publique** até entender por quê.
```

- [ ] **Passo 4: Commit**

```bash
git add scripts/pronto-para-publicar.sh docs/fluxo-de-trabalho.md
git commit -m "Checagem de um comando antes de publicar, e o fluxo de trabalho escrito

Em 16/09 seis correcoes ficaram so na maquina local, a publicacao subiu a versao
antiga e duas consultas da Receita foram gastas no defeito ja corrigido. O script
responde 'posso publicar?' conferindo gravacao, envio, tipos e testes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Tarefa 4: Espera antes do download — o experimento da Receita

**O que se sabe (23/09):** o retorno da Receita chega em menos de 1 segundo e
traz **o mesmo tíquete** da resposta do pedido. Nenhuma informação nova — é
aviso de recebimento, não de arquivo pronto. Cada tíquete foi tocado **uma
única vez** e ainda assim voltou 401 "Tíquete inexistente ou download já
realizado". A versão 2 da API criou um endereço de situação e um tempo estimado
de atendimento — o que só faz sentido se for preciso esperar.

**Hipótese:** baixar logo depois do retorno queima o único acesso numa hora em
que o arquivo ainda não existe.

**O que esta tarefa faz:** enquanto não passarem 10 minutos do retorno, o
sistema **não toca no tíquete** — nem pelo download automático no recebimento,
nem pelo botão. A linha continua na fila e é baixada depois.

**Os 10 minutos são parâmetro de experimento, não regra da documentação.** O
manual da v1 não diz quanto esperar. O valor mora numa constante só, para
ajustar com evidência.

**Arquivos:**
- Criar: `src/lib/rtc-v2/espera.ts`
- Criar: `src/lib/rtc-v2/espera.test.ts`
- Modificar: `src/lib/rtc-apuracao.server.ts` — select perto da linha 1265; ramo `} else if (!payload) {` perto da linha 1323

**Interfaces:**
- Consome: `registrarNota(admin, apuracaoId, chave: string, nivel: "info" | "aviso" | "erro", dados: Record<string, unknown>)` — já existe em `rtc-apuracao.server.ts`.
- Produz: `ESPERA_MINIMA_DOWNLOAD_MS: number`, `liberacaoDoDownload(e: EntradaEspera): number | null`, `cedoDemaisParaBaixar(e: EntradaEspera): boolean`, com `type EntradaEspera = { recebidoEm: string | null | undefined; solicitadoEm: string | null | undefined; agora: number }`.

- [ ] **Passo 1: Escrever o teste**

`src/lib/rtc-v2/espera.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cedoDemaisParaBaixar, ESPERA_MINIMA_DOWNLOAD_MS, liberacaoDoDownload } from "./espera";

const RETORNO = "2026-09-23T11:59:49.000Z";
const T0 = Date.parse(RETORNO);

describe("cedo demais para baixar?", () => {
  it("logo depois do retorno é cedo demais — o caso de 23/09", () => {
    // O retorno chegou 1,5 s depois do pedido; baixar aí queimava o tíquete.
    expect(cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: T0 + 1_500 })).toBe(true);
  });

  it("libera exatamente quando a espera termina", () => {
    const fim = T0 + ESPERA_MINIMA_DOWNLOAD_MS;
    expect(cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: fim - 1 })).toBe(true);
    expect(cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: fim })).toBe(false);
  });

  it("sem retorno registrado, conta a partir do pedido", () => {
    expect(cedoDemaisParaBaixar({ recebidoEm: null, solicitadoEm: RETORNO, agora: T0 + 60_000 })).toBe(true);
    expect(liberacaoDoDownload({ recebidoEm: null, solicitadoEm: RETORNO, agora: 0 })).toBe(
      T0 + ESPERA_MINIMA_DOWNLOAD_MS,
    );
  });

  it("o retorno tem prioridade sobre o pedido", () => {
    const pedido = "2026-09-23T11:00:00.000Z";
    expect(liberacaoDoDownload({ recebidoEm: RETORNO, solicitadoEm: pedido, agora: 0 })).toBe(
      T0 + ESPERA_MINIMA_DOWNLOAD_MS,
    );
  });

  it("sem nenhuma data legível não bloqueia", () => {
    // Na prática inalcançável — o banco grava as duas datas sozinho. Bloquear
    // aqui prenderia a linha para sempre sem ninguém conseguir destravar.
    for (const ruim of [null, undefined, "", "ontem"]) {
      expect(cedoDemaisParaBaixar({ recebidoEm: ruim, solicitadoEm: ruim, agora: T0 })).toBe(false);
      expect(liberacaoDoDownload({ recebidoEm: ruim, solicitadoEm: ruim, agora: T0 })).toBeNull();
    }
  });

  it("dia seguinte está liberado", () => {
    expect(
      cedoDemaisParaBaixar({ recebidoEm: RETORNO, solicitadoEm: null, agora: T0 + 24 * 3600_000 }),
    ).toBe(false);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `./node_modules/.bin/vitest run src/lib/rtc-v2/espera.test.ts`
Esperado: FALHA — `Failed to resolve import "./espera"`.

- [ ] **Passo 3: Implementar**

`src/lib/rtc-v2/espera.ts`:

```ts
/**
 * Quanto esperar entre o retorno da Receita e o download (API v1).
 *
 * EXPERIMENTO de 23/09/2026 — não é regra da documentação. O manual da v1 não
 * diz quanto esperar. O que se sabe: o retorno chega em menos de 1 s e traz o
 * MESMO tíquete da resposta do pedido — é aviso de recebimento, não de arquivo
 * pronto. Em 23/09 cada tíquete foi tocado uma única vez e ainda assim voltou
 * 401 "Tíquete inexistente ou download já realizado". A v2 criou um endereço de
 * situação e um tempo estimado de atendimento, o que só faz sentido se for
 * preciso esperar.
 *
 * Como o tíquete tem UM acesso, baixar cedo demais o perde. Esperar custa
 * minutos; errar custa a consulta do dia. O valor mora aqui e só aqui, para ser
 * ajustado com a evidência do histórico (`rtc_apuracao.historico`).
 */
export const ESPERA_MINIMA_DOWNLOAD_MS = 10 * 60 * 1000;

export type EntradaEspera = {
  /** Quando o retorno da Receita chegou (`webhook_recebido_em`). */
  recebidoEm: string | null | undefined;
  /** Quando o pedido foi feito (`solicitado_em`) — usado se não houve retorno. */
  solicitadoEm: string | null | undefined;
  /** Agora explícito: quem chama passa `Date.now()`; o teste passa o que quiser. */
  agora: number;
};

function instante(valor: string | null | undefined): number | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const ms = Date.parse(valor.trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Instante a partir do qual o download pode ser tentado; `null` se não há data. */
export function liberacaoDoDownload(e: EntradaEspera): number | null {
  const base = instante(e.recebidoEm) ?? instante(e.solicitadoEm);
  return base === null ? null : base + ESPERA_MINIMA_DOWNLOAD_MS;
}

/**
 * Ainda é cedo demais para tocar no tíquete?
 *
 * Sem nenhuma data legível responde `false`: na prática é inalcançável (o banco
 * grava as duas sozinho), e bloquear prenderia a linha para sempre.
 */
export function cedoDemaisParaBaixar(e: EntradaEspera): boolean {
  const libera = liberacaoDoDownload(e);
  return libera !== null && e.agora < libera;
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `./node_modules/.bin/vitest run src/lib/rtc-v2/espera.test.ts`
Esperado: 6 testes passando.

- [ ] **Passo 5: Aplicar a espera no servidor**

Em `src/lib/rtc-apuracao.server.ts`:

(a) Import, junto dos outros de `@/lib/rtc-v2/`:

```ts
import { cedoDemaisParaBaixar, liberacaoDoDownload } from "@/lib/rtc-v2/espera";
```

(b) No `select` de `processarApuracao` (perto da linha 1265), acrescentar `webhook_recebido_em` à lista. A linha fica:

```ts
      "id, tenant_id, competencia, status, solicitado_em, webhook_recebido_em, tiquete_download, access_token_ref, payload, url_assinada, url_assinada_expira_em",
```

(c) Logo depois de `  } else if (!payload) {` (perto da linha 1323), **antes** de `let credential: Credential;`, inserir:

```ts
    /*
     * Experimento de 23/09 — ver src/lib/rtc-v2/espera.ts. Enquanto for cedo, o
     * tíquete NÃO é tocado: ele tem um único acesso. Nada é marcado como erro;
     * a linha continua em 'tiquete_recebido' e a fila de download a pega
     * depois. Vale também para o download automático que o recebimento dispara
     * na hora — que é justamente o que queimava o tíquete.
     */
    const espera = {
      recebidoEm: (row.webhook_recebido_em as string | null) ?? null,
      solicitadoEm: (row.solicitado_em as string | null) ?? null,
      agora: Date.now(),
    };
    if (cedoDemaisParaBaixar(espera)) {
      const libera = liberacaoDoDownload(espera) as number;
      const hora = new Date(libera).toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
      });
      await registrarNota(admin, apuracaoId, "download_adiado", "info", {
        libera_em: new Date(libera).toISOString(),
      });
      return {
        ok: false,
        id: apuracaoId,
        motivo: `A Receita ainda está preparando o arquivo. Use "Reprocessar retorno" a partir das ${hora}.`,
      };
    }
```

- [ ] **Passo 6: Tipos e suíte**

Rodar: `./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vitest run`
Esperado: tipos sem erro; todos os testes passando (83 + 6).

- [ ] **Passo 7: Provar que o teste pega a regressão**

Trocar temporariamente em `espera.ts` a última linha de `cedoDemaisParaBaixar` por `return false;`, rodar `./node_modules/.bin/vitest run src/lib/rtc-v2/espera.test.ts`, confirmar falha em pelo menos 2 testes, e **restaurar** a linha original. Conferir com `git diff src/lib/rtc-v2/espera.ts` que não sobrou alteração.

- [ ] **Passo 8: Commit e envio**

```bash
git add src/lib/rtc-v2/espera.ts src/lib/rtc-v2/espera.test.ts src/lib/rtc-apuracao.server.ts
git commit -m "Download espera 10 minutos depois do retorno da Receita

Experimento. O retorno chega em menos de 1 s e traz o mesmo tiquete da resposta
do pedido: e aviso de recebimento, nao de arquivo pronto. Em 23/09 cada tiquete
foi tocado uma unica vez e voltou 401 'inexistente ou ja realizado'. Hipotese:
baixar cedo queima o unico acesso antes de o arquivo existir.

Enquanto for cedo o tiquete nao e tocado, nada vira erro, e a linha continua na
fila. Os 10 minutos sao parametro de experimento, numa constante so.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
bash scripts/pronto-para-publicar.sh && git push origin main
```

- [ ] **Passo 9: O experimento (usuário + assistente, no dia seguinte à publicação)**

Pré-requisitos, nesta ordem (ver `docs/fluxo-de-trabalho.md`, "Ordem: publicar o código antes de colar mudanças do banco"):

- código com a Tarefa 6 publicado (commit `ae1b6eb` ou posterior), **depois** de `pronto-para-publicar.sh` dizer PRONTO;
- migrações 0231, 0232, 0233 e 0234 aplicadas (arquivos em `docs/colar-no-supabase/`; a 0231 é `supabase/migrations/20260917120000_0231_fila_nao_repete_tiquete_gasto.sql`).

1. Usuário: **uma** consulta. Não clicar em mais nada.
2. Esperar 10 minutos. A mensagem na tela diz a partir de que horas.
3. Usuário: clicar em "Reprocessar retorno" **uma vez**.
4. Assistente: ler o histórico completo:

```sql
select solicitado_em, webhook_recebido_em, download_em, status, erro,
       jsonb_pretty(historico) as historico
from rtc_apuracao order by solicitado_em desc limit 1;
```

**Como ler o resultado:**

| Resultado | Conclusão | Próximo passo |
|---|---|---|
| `download_em` preenchido | Hipótese confirmada: era cedo demais | Fase 4 do roteiro pode começar; ajustar a espera com o tempo real observado |
| 401 com 10 min | Ainda cedo, ou hipótese errada | Repetir no dia seguinte com `ESPERA_MINIMA_DOWNLOAD_MS = 60 * 60 * 1000` |
| 401 também com 60 min | Hipótese derrubada | Parar de ajustar tempo. Investigar a forma de enviar o tíquete (ele tem sufixo `.XXXXXXXX`) com a evidência do histórico — sem gastar consulta em palpite |

---

### Tarefa 5: Conciliação — "sem nota nossa" deixa de ser "imposto zero"

**O defeito:** `conciliacao_documentos` e `conciliacao_documentos_page`
devolvem `coalesce(i.cbs_cents, 0)`. Quando a nota da Receita **não tem
correspondente** aqui, o "nosso cálculo" chega como **zero**; quando a nota
existe mas **ainda não foi calculada**, também chega como zero. A tela não tem
como distinguir de uma nota legitimamente imune. Em cima disso,
`motivoDivergencia` repete o padrão: `nosso === 0` vira "sem correspondente"
(errado para nota imune), e diferença desconhecida vira "Valores iguais".

**A correção** mexe nos dois lados — só a tela não basta, porque o zero nasce
no banco:
- o banco devolve `nosso_cents` **nulo** quando não há valor, e uma coluna nova
  `tem_correspondente`;
- a regra do motivo vira função pura com teste;
- a tela mostra "—" para valor desconhecido.

**Arquivos:**
- Criar: `supabase/migrations/20260923180000_0232_conciliacao_ausente_nao_e_zero.sql`
- Criar: `src/lib/conciliacao-motivo.ts`
- Criar: `src/lib/conciliacao-motivo.test.ts`
- Modificar: `src/lib/rtc.ts` — tipo `ConciliacaoDoc` (linha 538), função `motivoDivergencia` (linha 731) e `money` dentro de `conciliacaoCsv` (linha 755)
- Modificar: `src/components/techiva/conciliacao.tsx` — exibição de `nosso_cents` e `diferenca_cents`

**Interfaces:**
- Consome: nada de tarefas anteriores.
- Produz: `motivoDivergencia(doc: DocParaMotivo): string` em `src/lib/conciliacao-motivo.ts`, com `type DocParaMotivo = { tem_correspondente: boolean; nosso_cents: number | null; diferenca_cents: number | null; situacao: string | null }`. `rtc.ts` reexporta com o mesmo nome — o import existente em `conciliacao.tsx` continua funcionando.

- [ ] **Passo 1: Escrever o teste da regra**

`src/lib/conciliacao-motivo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { motivoDivergencia } from "./conciliacao-motivo";

const base = { tem_correspondente: true, nosso_cents: 1000, diferenca_cents: 0, situacao: "nao_extinto" };

describe("motivo da divergência", () => {
  it("nota que a Receita tem e nós não", () => {
    expect(
      motivoDivergencia({ ...base, tem_correspondente: false, nosso_cents: null, diferenca_cents: null }),
    ).toBe("Nota na Receita sem correspondente aqui");
  });

  it("nota imune, calculada com zero, NÃO é 'sem correspondente'", () => {
    // O defeito: nosso_cents === 0 era lido como ausência.
    expect(motivoDivergencia({ ...base, nosso_cents: 0, diferenca_cents: 0 })).toBe("Valores iguais");
  });

  it("nota nossa ainda sem cálculo", () => {
    expect(motivoDivergencia({ ...base, nosso_cents: null, diferenca_cents: null })).toBe(
      "Nossa nota ainda não foi calculada",
    );
  });

  it("diferença desconhecida NÃO é 'Valores iguais'", () => {
    expect(motivoDivergencia({ ...base, diferenca_cents: null })).toBe("Diferença não calculada");
  });

  it("cancelado na Receita", () => {
    expect(motivoDivergencia({ ...base, situacao: "cancelado", diferenca_cents: 500 })).toBe(
      "Documento cancelado na Receita",
    );
  });

  it("sentido da diferença", () => {
    expect(motivoDivergencia({ ...base, diferenca_cents: 1 })).toBe("Receita apurou mais do que calculamos");
    expect(motivoDivergencia({ ...base, diferenca_cents: -1 })).toBe("Calculamos mais do que a Receita apurou");
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `./node_modules/.bin/vitest run src/lib/conciliacao-motivo.test.ts`
Esperado: FALHA — `Failed to resolve import "./conciliacao-motivo"`.

- [ ] **Passo 3: Implementar a regra**

`src/lib/conciliacao-motivo.ts`:

```ts
/**
 * Motivo provável da divergência entre a Receita e o nosso cálculo, em
 * linguagem de quem confere nota.
 *
 * Função pura, fora de `rtc.ts`, porque `rtc.ts` carrega o cliente do Supabase
 * e não roda em teste. `rtc.ts` reexporta com o mesmo nome.
 *
 * A regra que esta função existe para garantir: AUSENTE NÃO É ZERO. Antes,
 * `nosso_cents ?? 0` fazia a nota imune (calculada com zero) aparecer como "sem
 * correspondente", e diferença desconhecida aparecer como "Valores iguais".
 */
export type DocParaMotivo = {
  /** Existe nota nossa com a mesma chave. */
  tem_correspondente: boolean;
  /** CBS calculada por nós; `null` = não sabemos (sem nota, ou nota sem cálculo). */
  nosso_cents: number | null;
  /** Receita − nós; `null` quando não dá para calcular. */
  diferenca_cents: number | null;
  situacao: string | null;
};

export function motivoDivergencia(doc: DocParaMotivo): string {
  if (!doc.tem_correspondente) return "Nota na Receita sem correspondente aqui";
  if (doc.situacao === "cancelado") return "Documento cancelado na Receita";
  if (doc.nosso_cents === null) return "Nossa nota ainda não foi calculada";
  if (doc.diferenca_cents === null) return "Diferença não calculada";
  if (doc.diferenca_cents > 0) return "Receita apurou mais do que calculamos";
  if (doc.diferenca_cents < 0) return "Calculamos mais do que a Receita apurou";
  return "Valores iguais";
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `./node_modules/.bin/vitest run src/lib/conciliacao-motivo.test.ts`
Esperado: 6 testes passando.

- [ ] **Passo 5: Ligar em `rtc.ts`**

No tipo `ConciliacaoDoc` (linha 538), acrescentar o campo novo depois de `grupo`:

```ts
  /** Existe nota nossa com a mesma chave. Vem do banco a partir da migração 0232. */
  tem_correspondente: boolean;
```

Apagar a função `motivoDivergencia` inteira (linhas 730–739, incluindo o comentário acima dela) e colocar no lugar:

```ts
/** A regra mora em conciliacao-motivo.ts, pura e testada. */
export { motivoDivergencia } from "@/lib/conciliacao-motivo";
```

- [ ] **Passo 6: A tela e o CSV mostram "—" / vazio para desconhecido**

A tela repete o defeito em três lugares, e um deles é o **semáforo**: hoje uma
nota imune (calculada com zero, receita > 0) acende **vermelho crítico**, como
se a nota não existisse aqui.

(a) Em `src/components/techiva/conciliacao.tsx`, perto da linha 230, trocar:

```tsx
                    const diff = doc.diferenca_cents ?? 0;
                    const semNosso = (doc.nosso_cents ?? 0) === 0 && (doc.receita_cents ?? 0) > 0;
                    const level: SemaphoreLevel = diff === 0 ? "ok" : semNosso ? "crit" : "warn";
```

por:

```tsx
                    // Ausente não é zero: `null` = não sabemos. Nota imune (nosso = 0)
                    // não é "sem correspondente" — era vermelho crítico por engano.
                    const diff = doc.diferenca_cents;
                    const level: SemaphoreLevel = !doc.tem_correspondente
                      ? "crit"
                      : diff === 0
                        ? "ok"
                        : "warn";
```

(b) Perto da linha 268, trocar:

```tsx
                          {formatCents(doc.nosso_cents ?? 0)}
```

por:

```tsx
                          {doc.nosso_cents === null ? "—" : formatCents(doc.nosso_cents)}
```

(c) Na célula da diferença, logo abaixo, trocar:

```tsx
                        <td
                          className={`num px-3 py-2.5 align-top ${
                            diff === 0 ? "" : diff > 0 ? "text-flow-out" : "text-primary"
                          }`}
                        >
                          {formatCents(diff)}
                        </td>
```

por:

```tsx
                        <td
                          className={`num px-3 py-2.5 align-top ${
                            diff === null || diff === 0 ? "" : diff > 0 ? "text-flow-out" : "text-primary"
                          }`}
                        >
                          {diff === null ? "—" : formatCents(diff)}
                        </td>
```

(d) Em `src/lib/rtc.ts`, perto da linha 755 (dentro de `conciliacaoCsv`), trocar:

```ts
  const money = (c: number | null) => ((c ?? 0) / 100).toFixed(2).replace(".", ",");
```

por:

```ts
  // Célula vazia para desconhecido — "0,00" no CSV seria afirmar um valor que não temos.
  const money = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(".", ","));
```

Não trocar `null` por `0` em lugar nenhum. (`rtc.ts:43` também tem um `diferenca_cents`, mas é de outra função — `apuracao_divergencia` — e está no item 11 da Tarefa 6.)

Rodar: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Esperado: sem erro. Se o TypeScript acusar `tem_correspondente` ausente em algum objeto montado à mão (teste, mock, dado de exemplo), acrescentar o campo com o valor coerente com aquele objeto.

- [ ] **Passo 7: A migração**

`supabase/migrations/20260923180000_0232_conciliacao_ausente_nao_e_zero.sql`:

```sql
-- 0232_conciliacao_ausente_nao_e_zero.sql
--
-- As duas funções de conciliação devolviam coalesce(i.cbs_cents, 0). Nota da
-- Receita SEM correspondente aqui, e nota nossa AINDA NÃO CALCULADA, chegavam
-- ambas como "nosso cálculo = 0" — indistinguíveis de uma nota imune. A tela não
-- tinha como mostrar a verdade porque o zero nascia aqui.
--
-- Agora: nosso_cents e diferenca_cents são NULOS quando não há valor, e a coluna
-- nova tem_correspondente diz se existe nota nossa com a mesma chave.
--
-- A lista de colunas devolvida muda, então é drop + create (senão SQLSTATE
-- 42P13). O drop apaga as permissões: reemitidas iguais às de antes
-- (authenticated, service_role — conferido em 23/09).
--
-- Filtro "só divergentes": passa a incluir também a nota nossa sem cálculo.
-- Ordenação por diferença: quem não tem diferença calculável ordena pelo valor
-- da Receita, como antes (antes a diferença delas era o valor inteiro).

drop function if exists public.conciliacao_documentos(uuid, date, boolean);

create function public.conciliacao_documentos(
  p_tenant uuid, p_competencia date, p_so_divergentes boolean default true)
returns table(chave_dfe text, numero_dfe text, contraparte text, receita_cents bigint,
              nosso_cents bigint, diferenca_cents bigint, nao_extinto_cents bigint,
              situacao debito_situacao, grupo apuracao_grupo, tem_correspondente boolean)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  return query
  select d.chave_dfe, d.numero_dfe,
         coalesce(c.name, d.ni_adquirente) as contraparte,
         d.cbs_total_cents,
         i.cbs_cents,
         (d.cbs_total_cents - i.cbs_cents)::bigint,
         d.cbs_nao_extinto_cents,
         d.situacao, d.grupo,
         (i.id is not null)
  from rtc_debito d
  left join invoices i on i.tenant_id = d.tenant_id and i.access_key = d.chave_dfe
  left join counterparties c on c.id = i.counterparty_id
  where d.tenant_id = p_tenant
    and d.competencia = date_trunc('month', p_competencia)::date
    and (not p_so_divergentes
         or i.id is null                        -- a Receita tem, nós não
         or i.cbs_cents is null                 -- temos a nota, sem cálculo
         or d.cbs_total_cents <> i.cbs_cents)   -- valor divergente
  order by abs(coalesce(d.cbs_total_cents - i.cbs_cents, d.cbs_total_cents)) desc nulls last;
end $function$;

revoke all on function public.conciliacao_documentos(uuid, date, boolean) from public, anon;
grant execute on function public.conciliacao_documentos(uuid, date, boolean) to authenticated, service_role;

drop function if exists public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text);

create function public.conciliacao_documentos_page(
  p_tenant uuid, p_competencia date, p_so_divergentes boolean default true,
  p_order text default 'diferenca', p_dir text default 'desc',
  p_limit integer default 50, p_offset integer default 0, p_search text default null)
returns table(debito_id bigint, chave_dfe text, numero_dfe text, contraparte text,
              receita_cents bigint, nosso_cents bigint, diferenca_cents bigint,
              nao_extinto_cents bigint, situacao debito_situacao, grupo apuracao_grupo,
              total_count bigint, tem_correspondente boolean)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_order text := lower(coalesce(p_order, 'diferenca'));
  v_desc  boolean := lower(coalesce(p_dir, 'desc')) <> 'asc';
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_off   integer := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not in_scope(p_tenant) then raise exception 'forbidden'; end if;
  if v_order not in ('diferenca','receita','nosso','nao_extinto','numero') then
    v_order := 'diferenca';
  end if;

  return query
  with base as (
    select d.id,
           d.chave_dfe,
           d.numero_dfe,
           coalesce(c.name, d.ni_adquirente) as contraparte,
           d.cbs_total_cents as receita_cents,
           i.cbs_cents::bigint as nosso_cents,
           (d.cbs_total_cents - i.cbs_cents)::bigint as diferenca_cents,
           d.cbs_nao_extinto_cents as nao_extinto_cents,
           d.situacao,
           d.grupo,
           (i.id is not null) as tem_correspondente
    from rtc_debito d
    left join invoices i
      on i.tenant_id = d.tenant_id and i.access_key = d.chave_dfe
    left join counterparties c on c.id = i.counterparty_id
    where d.tenant_id = p_tenant
      and d.competencia = date_trunc('month', p_competencia)::date
      and (not p_so_divergentes
           or i.id is null
           or i.cbs_cents is null
           or d.cbs_total_cents <> i.cbs_cents)
      and (v_q is null
           or d.numero_dfe ilike '%' || v_q || '%'
           or d.chave_dfe ilike '%' || v_q || '%'
           or coalesce(c.name, d.ni_adquirente) ilike '%' || v_q || '%')
  ), counted as (
    select base.*, count(*) over () as total_count from base
  )
  select counted.id, counted.chave_dfe, counted.numero_dfe, counted.contraparte,
         counted.receita_cents, counted.nosso_cents, counted.diferenca_cents,
         counted.nao_extinto_cents, counted.situacao, counted.grupo,
         counted.total_count, counted.tem_correspondente
  from counted
  order by
    -- ordenação estável: chave escolhida + desempate por id. Sem diferença
    -- calculável, ordena pelo valor da Receita, como antes.
    case when v_desc then
      case v_order
        when 'diferenca'   then abs(coalesce(counted.diferenca_cents, counted.receita_cents))
        when 'receita'     then counted.receita_cents
        when 'nosso'       then counted.nosso_cents
        when 'nao_extinto' then counted.nao_extinto_cents
        else null
      end
    end desc nulls last,
    case when not v_desc then
      case v_order
        when 'diferenca'   then abs(coalesce(counted.diferenca_cents, counted.receita_cents))
        when 'receita'     then counted.receita_cents
        when 'nosso'       then counted.nosso_cents
        when 'nao_extinto' then counted.nao_extinto_cents
        else null
      end
    end asc nulls last,
    case when v_order = 'numero' and v_desc then counted.numero_dfe end desc nulls last,
    case when v_order = 'numero' and not v_desc then counted.numero_dfe end asc nulls last,
    counted.id desc
  limit v_limit offset v_off;
end $function$;

revoke all on function public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text) from public, anon;
grant execute on function public.conciliacao_documentos_page(uuid, date, boolean, text, text, integer, integer, text) to authenticated, service_role;
```

- [ ] **Passo 8: Arquivo para o usuário colar no Supabase**

Gerar `docs/0232-para-colar-no-supabase.sql` = conteúdo da migração + no fim:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260923180000', '0232_conciliacao_ausente_nao_e_zero')
on conflict (version) do nothing;

-- Conferência: as duas funções existem, devolvem a coluna nova, e com as permissões certas.
select p.proname,
       pg_get_function_result(p.oid) like '%tem_correspondente boolean%' as tem_coluna_nova,
       (select string_agg(grantee, ', ' order by grantee)
          from information_schema.role_routine_grants g
         where g.routine_schema = 'public' and g.routine_name = p.proname) as permissoes
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('conciliacao_documentos', 'conciliacao_documentos_page');
```

Esperado ao rodar: duas linhas, `tem_coluna_nova = true`, `permissoes = authenticated, postgres, service_role`.

**Ordem de publicação:** a migração vai **antes** do código. O código novo lê `tem_correspondente`; se publicar o código com o banco antigo, a coluna vem ausente e toda nota aparece como "sem correspondente". O banco novo com o código antigo é inofensivo (coluna extra ignorada, `null` já era aceito pelo tipo).

- [ ] **Passo 9: Suíte, commit, envio**

Rodar: `./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vitest run`
Esperado: tudo passando.

```bash
git add supabase/migrations/20260923180000_0232_conciliacao_ausente_nao_e_zero.sql src/lib/conciliacao-motivo.ts src/lib/conciliacao-motivo.test.ts src/lib/rtc.ts src/components/techiva/conciliacao.tsx
git commit -m "Conciliacao: nota sem correspondente deixa de aparecer como imposto zero

As funcoes de conciliacao devolviam coalesce(i.cbs_cents, 0): nota da Receita
sem nota nossa, e nota nossa ainda sem calculo, chegavam como 'nosso = 0',
iguais a uma nota imune. motivoDivergencia repetia o padrao e ainda chamava
diferenca desconhecida de 'Valores iguais'. O zero nascia no banco, entao a
correcao e nos dois lados: nulo quando nao ha valor, coluna tem_correspondente,
regra pura com teste, e '—' na tela.

A migracao 0232 precisa ser aplicada ANTES de publicar este codigo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

Avisar o usuário, nesta ordem: (1) rodar `docs/0232-para-colar-no-supabase.sql`; (2) só então publicar.

---

### Tarefa 6: Auditoria dos zeros-por-falta que sobraram

Em caminhos de dinheiro ainda há `?? 0` que podem estar transformando
"não sabemos" em "R$ 0,00". Nem todo `?? 0` é defeito: se o banco **nunca**
devolve nulo naquele campo, é só defesa inofensiva. Esta tarefa classifica cada
um com evidência, e corrige só os que mentem.

**Lista a classificar** (levantada em 23/09):

| # | Arquivo:linha | Campo |
|---|---|---|
| 1 | `src/lib/alerts.ts:172` | `gap_critical_cents` |
| 2 | `src/lib/billing-history.server.ts:89` | `grand_total` → `amountCents` |
| 3 | `src/lib/chain.ts:46` | `total_cents` |
| 4 | `src/lib/chain.ts:47` | `credit_lost_cents` |
| 5 | `src/lib/commissions.ts:86` | `mrr_cents` (linha) |
| 6 | `src/lib/commissions.ts:87` | `commission_cents` (linha) |
| 7 | `src/lib/commissions.ts:92` | `totals.mrr_cents` |
| 8 | `src/lib/commissions.ts:93` | `totals.commission_cents` |
| 9 | `src/lib/portfolio.ts:27` | `gap_30_cents` |
| 10 | `src/lib/portfolio.ts:28` | `gap_90_cents` |
| 11 | função do banco `apuracao_divergencia` | `coalesce(v_receita.debitos_cents, 0)` na diferença e no "divergente" |

(`src/lib/error-page.ts` apareceu na busca, mas é CSS — falso positivo.)

**Arquivos:**
- Criar: `docs/auditoria/2026-09-23-zeros-por-falta.md`
- Modificar: só os arquivos cujo item for classificado como **mente**.

**Interfaces:**
- Consome: a regra de exibição da Tarefa 5 (`null` → "—").
- Produz: o documento de classificação.

- [ ] **Passo 1: Para cada item, achar de onde o campo vem**

Abrir o arquivo na linha; subir até a chamada ao banco (`rpc("nome", …)` ou `from("tabela")`). Anotar o nome.

- [ ] **Passo 2: Descobrir se o banco pode devolver nulo**

Para função (RPC), rodar no banco (o assistente consegue ler):

```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'NOME_DA_FUNCAO';
```

e procurar como o campo é produzido. Para tabela:

```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'NOME_DA_TABELA' and column_name = 'NOME_DO_CAMPO';
```

- [ ] **Passo 3: Classificar**

- **Inofensivo** — o banco nunca devolve nulo ali (coluna `NOT NULL`, ou a própria função já garante valor com significado real, como soma de zero linhas = 0). Nada a mudar.
- **Mente** — o banco pode devolver nulo, e nulo significa "não calculado / não sabemos". O `?? 0` faz a tela mostrar R$ 0,00 como se fosse fato.

- [ ] **Passo 4: Escrever `docs/auditoria/2026-09-23-zeros-por-falta.md`**

Uma linha por item, com a evidência:

```markdown
# Zeros por falta em caminhos de dinheiro — 23/09/2026

Regra: ausente não é zero. Um `?? 0` só é aceitável se o banco nunca devolve
nulo naquele campo.

| # | Onde | Campo | Origem no banco | Pode ser nulo? (evidência) | Classificação | Ação |
|---|---|---|---|---|---|---|
| 1 | alerts.ts:172 | gap_critical_cents | … | … | Inofensivo / Mente | … |
```

- [ ] **Passo 5: Corrigir cada item "Mente"**

Para cada um, no mesmo padrão da Tarefa 5:
- no TypeScript, o campo passa a ser `number | null` e o `?? 0` sai (`Number(x ?? 0)` vira `x === null || x === undefined ? null : Number(x)`);
- na tela, `null` aparece como "—";
- se o zero nasce no banco (`coalesce(..., 0)` na função), migração nova no padrão da Tarefa 5 (drop + create só se a lista de colunas mudar; reemitir as permissões existentes, conferidas antes com a consulta de `role_routine_grants`), e arquivo para o usuário colar;
- se a regra de decisão for não trivial, extrair para função pura com teste, como `conciliacao-motivo.ts`.

**Um commit por item corrigido**, mensagem dizendo o que a tela mostrava antes e o que mostra agora.

Se nenhum item for "Mente": ótimo — o documento registra isso com a evidência, e é esse o entregável.

- [ ] **Passo 6: Commit do documento e envio**

```bash
git add docs/auditoria/2026-09-23-zeros-por-falta.md
git commit -m "Auditoria dos zeros-por-falta em caminhos de dinheiro

Cada ?? 0 classificado com evidencia do banco: inofensivo (o banco nunca devolve
nulo) ou mente (nulo quer dizer 'nao sabemos' e a tela mostrava R\$ 0,00).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
bash scripts/pronto-para-publicar.sh && git push origin main
```

---

## Ao final da Fase 0

- Suíte 100% verde, e verde no GitHub a cada envio — inclusive os do Lovable.
- Publicar passa por um comando que responde "posso?".
- Nenhum caminho conhecido de dinheiro mostra R$ 0,00 para o que não sabe.
- O experimento da Receita rodou com evidência completa, e a conclusão está registrada.

Com isso, a Fase 1 do roteiro (selo em todo número) pode começar sobre chão firme.
