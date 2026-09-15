# Adequação à API v2 de Apuração da CBS — Plano de Implementação

> **Para quem executa:** use `superpowers:subagent-driven-development` ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** deixar o TECH-IVA capaz de consumir a API v2 de apuração da CBS, que entra em outubro/2026, sem depender de o nosso endereço de retorno ser alcançável pela internet e sem perder dado por causa do modelo incremental.

**Arquitetura:** o transporte (autenticar, abrir solicitação, acompanhar, baixar) fica em `src/lib/rtc-apuracao.server.ts`, como hoje. O **formato** do arquivo v2 passa a ser lido por funções puras em um módulo novo, com teste unitário — porque é a parte que mais promete surpreender e a que precisa de correção barata. O **dinheiro** continua sendo gravado por função do banco: nada de soma ou classificação no front, regra do projeto.

**Pilha:** TanStack Start, TypeScript, Supabase/Postgres, vitest.

**Fonte:** `https://docs.receitafederal.gov.br/apuracao-cbs/` — guia do fluxo assíncrono, débito, crédito, pagamentos, recolhimentos, situação. Lidas em 15/09/2026.

---

## Restrições globais

Valores copiados literalmente da documentação. Valem para todas as tarefas.

- **Endereço base:** `https://api.receitafederal.gov.br`
- **Caminho produção:** `/apuracao-cbs/v2/{recurso}/{cnpj}` · **produção restrita:** `/apuracao-cbs-prr/v2/{recurso}/{cnpj}`
  Recursos: `debitos`, `creditos`, `pagamentos`, `recolhimentos`, `situacao`
- **`{cnpj}` são os 8 primeiros dígitos** (CNPJ base)
- **Abertura de solicitação:** `POST`, corpo `{ "urlRetorno": "<https>" }`, header `Authorization: Bearer <token>`
- **Limite:** **4 chamadas por dia** no endpoint de abertura. Não se aplica a `situacao` nem ao download.
- **A Receita valida a `urlRetorno` com método `HEAD` antes de processar.** Falhando, *"a solicitação é cancelada com erro"*.
- **Resposta imediata:** HTTP 201 com `{ tiqueteSolicitacao, tEASegundos }`
- **Retorno (webhook ou `situacao`):** sucesso `{ tiqueteSolicitacao, urlAssinada, urlAssinadaExpiraEm }` · erro `{ codigoErro, mensagemErro }`
- **`urlAssinada` é URL pré-assinada, válida 48 h, downloads ilimitados.** É segredo temporário: nunca logar, nunca devolver ao navegador.
- **Prazo de processamento: 240 minutos.** Passou, é erro.
- **`situacao`:** `GET /apuracao-cbs/v2/situacao/{tiqueteSolicitacao}`, estados `PENDENTE`, `EM_PROCESSAMENTO`, `CONCLUIDA`, `ERRO`. Devolve `urlAssinada` quando concluída — **sem depender do webhook**.
- **Janela incremental: 8 dias.** Na primeira consulta (sem registro anterior), volta desde o dia 1º do mês corrente.
- **Valores vêm em `number(18,2)`, em reais.** O banco guarda centavos em `bigint`. **Converter por texto, nunca `valor * 100`** — `18.29 * 100` dá `1828.9999...` em ponto flutuante.
- **Toda ação que altera dinheiro, regra, permissão ou tenant grava em `audit_log`.**
- Nenhum valor fiscal é produzido por nós: o módulo transporta e grava o que a Receita devolveu. Motor fora do ar ⇒ erro explícito, nunca número estimado.

## O que NÃO entra neste plano

- **Gerar a credencial nova** no portal da Receita. É ação do Diogo e bloqueia tudo, mas não é código.
- **Desligar a v1.** Ela continua atendendo até a Receita encerrar. As tarefas abaixo convivem com ela.
- **A tela.** O plano em `.lovable/plan.md` (etapas 1 a 6) constrói a tela, e a regra dele continua valendo: conferir contra o JSON recebido, não contra o manual. Este plano entrega o dado; a tela vem depois, com dado real na mão.

## O portão de realidade

As tarefas 1 a 4 são **transporte** e podem ser construídas e testadas hoje, com servidor de mentira. As tarefas 5 em diante dependem do **formato**, e só se confirmam contra um arquivo real — que não existe antes de outubro. Elas são escritas contra o esquema publicado e **precisam ser reconferidas** quando o primeiro arquivo real chegar. Isso está marcado em cada uma.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/routes/api/public/rtc.apuracao.$ref.tsx` (modificar) | Passa a responder `HEAD` além de `POST`; aceita `urlAssinada` |
| `src/lib/rtc-v2/enderecos.ts` (criar) | Monta URL por recurso e ambiente. Função pura. |
| `src/lib/rtc-v2/retorno.ts` (criar) | Lê o corpo do retorno (webhook ou situação) e diz o que ele é. Função pura. |
| `src/lib/rtc-v2/valores.ts` (criar) | Converte `number(18,2)` em centavos sem ponto flutuante. Função pura. |
| `src/lib/rtc-v2/debitos.ts` (criar) | Normaliza o arquivo de débitos/créditos v2 em linhas. Função pura. |
| `src/lib/rtc-v2/arrecadacao.ts` (criar) | Normaliza pagamentos/recolhimentos v2 em linhas. Função pura. |
| `src/lib/rtc-apuracao.server.ts` (modificar) | Transporte: abrir, acompanhar, baixar pela `urlAssinada` |
| `db/migrations/0225_*.sql` … | Colunas e tabelas de acumulação incremental |

Cada módulo em `src/lib/rtc-v2/` ganha um `*.test.ts` ao lado. São funções puras: nada de rede, nada de banco.

---

### Tarefa 1: Responder ao HEAD da Receita

Sem isto, **toda solicitação v2 é cancelada antes de começar** e gasta uma das 4 do dia. É a única tarefa que é defeito, não evolução.

**Arquivos:**
- Modificar: `src/routes/api/public/rtc.apuracao.$ref.tsx`
- Testar: `src/lib/rtc-v2/refvalido.test.ts` (criar), `src/lib/rtc-v2/refvalido.ts` (criar)

**Interfaces:**
- Produz: `refValido(ref: string): boolean` — usada pelo handler para decidir sem tocar o banco.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// src/lib/rtc-v2/refvalido.test.ts
import { describe, expect, it } from "vitest";
import { refValido } from "./refvalido";

describe("formato da referência do webhook", () => {
  it("aceita 48 caracteres hexadecimais minúsculos", () => {
    expect(refValido("a".repeat(48))).toBe(true);
    expect(refValido("0123456789abcdef".repeat(3))).toBe(true);
  });

  it("recusa tamanho errado, maiúscula e caractere fora do hex", () => {
    expect(refValido("a".repeat(47))).toBe(false);
    expect(refValido("a".repeat(49))).toBe(false);
    expect(refValido("A".repeat(48))).toBe(false);
    expect(refValido("g".repeat(48))).toBe(false);
    expect(refValido("")).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run src/lib/rtc-v2/refvalido.test.ts`
Esperado: FAIL — módulo não encontrado.

- [ ] **Passo 3: implementar o mínimo**

```ts
// src/lib/rtc-v2/refvalido.ts
/**
 * A referência do webhook são 24 bytes aleatórios em hex, gerados por
 * `rtc_apuracao_solicitar`. Validar o formato antes de tocar o banco barra
 * varredura e permite responder ao HEAD sem consultar nada.
 */
export function refValido(ref: string): boolean {
  return /^[0-9a-f]{48}$/.test(ref);
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run src/lib/rtc-v2/refvalido.test.ts`
Esperado: PASS (2 testes).

- [ ] **Passo 5: adicionar o handler HEAD na rota**

Em `src/routes/api/public/rtc.apuracao.$ref.tsx`, importar `refValido` e trocar o bloco `handlers` para incluir `HEAD` **antes** do `POST`:

```tsx
      HEAD: async ({ params }) => {
        /*
         * A Receita valida a urlRetorno com HEAD antes de processar; se não
         * responder, "a solicitação é cancelada com erro" e a chamada do dia
         * é gasta à toa. Responde só pelo FORMATO da referência, sem tocar o
         * banco: assim não revela se uma referência existe, e não fica de pé
         * um caminho de varredura.
         */
        const ref = (params as { ref?: string }).ref ?? "";
        return new Response(null, { status: refValido(ref) ? 200 : 404 });
      },
```

E trocar a validação dentro do `POST` para usar a mesma função, em vez da expressão repetida:

```tsx
        if (!refValido(ref)) {
          return new Response("Referência inválida", { status: 404 });
        }
```

- [ ] **Passo 6: confirmar que o HEAD responde de verdade**

O framework pode não encaminhar `HEAD` para um handler próprio. **Isto tem de ser verificado, não suposto.**

Rodar em um terminal: `npm run dev`
Em outro: `curl -i -X HEAD "http://localhost:3000/api/public/rtc/apuracao/$(printf 'a%.0s' {1..48})"`
Esperado: `HTTP/1.1 200`.

Se vier 404 ou 405, o framework não roteia `HEAD` — então acrescentar também um handler `GET` idêntico (muitos servidores derivam `HEAD` de `GET`) e repetir o teste com `curl -I`. Registrar no commit qual dos dois funcionou.

- [ ] **Passo 7: typecheck, lint e build**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint --rule '{"prettier/prettier":"off"}' src/lib/rtc-v2 src/routes/api/public/rtc.apuracao.\$ref.tsx
npx vite build
```

(O `--rule` desliga o ruído de fim de linha, que é pré-existente no repo inteiro.)

- [ ] **Passo 8: commit**

```bash
git add src/lib/rtc-v2/refvalido.ts src/lib/rtc-v2/refvalido.test.ts src/routes/api/public/rtc.apuracao.\$ref.tsx
git commit -m "Responde ao HEAD da urlRetorno, exigido pela API v2"
```

---

### Tarefa 2: Entender o retorno novo (`urlAssinada`)

Hoje o retorno é lido procurando `tiqueteDownload`. A v2 manda `urlAssinada`. Sem isto, o retorno cai em erro — e com a v1 ainda viva, os dois formatos precisam conviver.

**Arquivos:**
- Criar: `src/lib/rtc-v2/retorno.ts`, `src/lib/rtc-v2/retorno.test.ts`
- Modificar: `src/routes/api/public/rtc.apuracao.$ref.tsx`
- Migration: `db/migrations/0225_apuracao_url_assinada.sql`

**Interfaces:**
- Consome: nada de tarefas anteriores.
- Produz: `lerRetorno(corpo: unknown): Retorno` onde
  `type Retorno = { tipo: "url"; url: string; expiraEm: string | null; tiquete: string | null } | { tipo: "tiquete"; tiquete: string } | { tipo: "erro"; codigo: string | null; mensagem: string | null } | { tipo: "desconhecido" }`

- [ ] **Passo 1: escrever o teste que falha**

```ts
// src/lib/rtc-v2/retorno.test.ts
import { describe, expect, it } from "vitest";
import { lerRetorno } from "./retorno";

describe("leitura do retorno da Receita", () => {
  it("reconhece o retorno v2 com url assinada", () => {
    expect(
      lerRetorno({
        tiqueteSolicitacao: "T-1",
        urlAssinada: "https://s3.exemplo/arquivo.json?assinatura=x",
        urlAssinadaExpiraEm: "2026-10-03T10:00:00Z",
      }),
    ).toEqual({
      tipo: "url",
      url: "https://s3.exemplo/arquivo.json?assinatura=x",
      expiraEm: "2026-10-03T10:00:00Z",
      tiquete: "T-1",
    });
  });

  it("reconhece o retorno v1 com tíquete de download", () => {
    expect(lerRetorno({ tiqueteDownload: "D-9" })).toEqual({ tipo: "tiquete", tiquete: "D-9" });
    expect(lerRetorno({ tiquete: "D-9" })).toEqual({ tipo: "tiquete", tiquete: "D-9" });
  });

  it("reconhece o retorno de erro", () => {
    expect(lerRetorno({ codigoErro: "E42", mensagemErro: "deu ruim" })).toEqual({
      tipo: "erro",
      codigo: "E42",
      mensagem: "deu ruim",
    });
  });

  it("recusa url que não seja https, para não virar caminho de vazamento", () => {
    expect(lerRetorno({ urlAssinada: "http://s3.exemplo/a.json" }).tipo).toBe("desconhecido");
    expect(lerRetorno({ urlAssinada: "ftp://s3.exemplo/a.json" }).tipo).toBe("desconhecido");
  });

  it("devolve desconhecido para corpo vazio ou sem os campos esperados", () => {
    expect(lerRetorno({}).tipo).toBe("desconhecido");
    expect(lerRetorno(null).tipo).toBe("desconhecido");
    expect(lerRetorno("texto").tipo).toBe("desconhecido");
    expect(lerRetorno([]).tipo).toBe("desconhecido");
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run src/lib/rtc-v2/retorno.test.ts`
Esperado: FAIL — módulo não encontrado.

- [ ] **Passo 3: implementar o mínimo**

```ts
// src/lib/rtc-v2/retorno.ts
/**
 * Lê o corpo devolvido pela Receita — no webhook ou na consulta de situação —
 * e diz o que ele é. A v1 manda tíquete de download; a v2 manda uma URL
 * pré-assinada. As duas convivem enquanto a v1 não for encerrada.
 *
 * A URL assinada é segredo temporário (48 h): quem usa esta função não pode
 * logá-la nem devolvê-la ao navegador.
 */
export type Retorno =
  | { tipo: "url"; url: string; expiraEm: string | null; tiquete: string | null }
  | { tipo: "tiquete"; tiquete: string }
  | { tipo: "erro"; codigo: string | null; mensagem: string | null }
  | { tipo: "desconhecido" };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function lerRetorno(corpo: unknown): Retorno {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { tipo: "desconhecido" };
  const o = corpo as Record<string, unknown>;

  const url = texto(o["urlAssinada"]);
  if (url) {
    // Só https: a URL carrega a autorização de download na própria query.
    if (!url.startsWith("https://")) return { tipo: "desconhecido" };
    return {
      tipo: "url",
      url,
      expiraEm: texto(o["urlAssinadaExpiraEm"]),
      tiquete: texto(o["tiqueteSolicitacao"]),
    };
  }

  const tiquete = texto(o["tiqueteDownload"]) ?? texto(o["tiquete"]);
  if (tiquete) return { tipo: "tiquete", tiquete };

  const codigo = texto(o["codigoErro"]);
  const mensagem = texto(o["mensagemErro"]);
  if (codigo || mensagem) return { tipo: "erro", codigo, mensagem };

  return { tipo: "desconhecido" };
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run src/lib/rtc-v2/retorno.test.ts`
Esperado: PASS (5 testes).

- [ ] **Passo 5: criar a migration das colunas novas**

Aplicar com a ferramenta de migration do Supabase e gravar o espelho em `db/migrations/0225_apuracao_url_assinada.sql`:

```sql
-- 0225_apuracao_url_assinada.sql — ESPELHO da migration aplicada no banco.
--
-- A v2 devolve uma URL pré-assinada no lugar do tíquete de download. Ela vale
-- 48 h e autoriza o download por si só — é segredo temporário, por isso fica
-- fora de qualquer retorno ao navegador (a policy de leitura da tabela é por
-- tenant, e a coluna nunca é selecionada pelo front).
alter table public.rtc_apuracao
  add column if not exists url_assinada          text,
  add column if not exists url_assinada_expira_em timestamptz;

comment on column public.rtc_apuracao.url_assinada is
  'URL pré-assinada da v2 (48 h). Segredo temporário: nunca expor ao navegador nem logar.';

-- Passa a aceitar os dois formatos de retorno. Mantém tudo o mais da 0223:
-- janela de 2 horas, uso único do webhook_ref, corpo bruto em webhook_payload.
create or replace function public.rtc_apuracao_receber_tiquete(p_ref text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v public.rtc_apuracao;
  v_tiquete text;
  v_url     text;
BEGIN
  SELECT * INTO v
    FROM public.rtc_apuracao
   WHERE webhook_ref = p_ref
     AND status = 'solicitada'
     AND solicitado_em > now() - interval '2 hours'
   FOR UPDATE;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_tiquete := coalesce(p_payload->>'tiqueteDownload', p_payload->>'tiquete');
  v_url     := p_payload->>'urlAssinada';

  UPDATE public.rtc_apuracao
     SET webhook_payload = p_payload,
         tiquete_solicitacao = coalesce(p_payload->>'tiqueteSolicitacao', tiquete_solicitacao),
         tiquete_download = v_tiquete,
         url_assinada = v_url,
         url_assinada_expira_em = nullif(p_payload->>'urlAssinadaExpiraEm','')::timestamptz,
         status = CASE
           WHEN v_url IS NOT NULL OR v_tiquete IS NOT NULL THEN 'tiquete_recebido'
           ELSE 'erro'
         END,
         erro = CASE
           WHEN v_url IS NULL AND v_tiquete IS NULL
             THEN coalesce(
                    nullif(p_payload->>'mensagemErro',''),
                    'retorno sem url assinada nem tiquete (corpo bruto em webhook_payload)')
           ELSE NULL
         END,
         webhook_recebido_em = now(),
         webhook_ref = NULL
   WHERE id = v.id;

  PERFORM public.log_audit(
    v.tenant_id, 'apuracao.tiquete', 'rtc_apuracao', v.id::text, NULL,
    jsonb_build_object('recebido_em', now(),
                       'formato', CASE WHEN v_url IS NOT NULL THEN 'v2' 
                                       WHEN v_tiquete IS NOT NULL THEN 'v1'
                                       ELSE 'erro' END)
  );

  RETURN jsonb_build_object('ok', true, 'id', v.id);
END;
$function$;
```

- [ ] **Passo 6: conferir a migration no banco (pós-voo)**

```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='rtc_apuracao'
   and column_name in ('url_assinada','url_assinada_expira_em');
```
Esperado: as duas linhas.

- [ ] **Passo 7: baixar pela URL assinada**

Em `src/lib/rtc-apuracao.server.ts`, acrescentar ao lado de `baixarNaReceita`:

```ts
/**
 * Passo 3 na v2: a URL já carrega a autorização, então vai SEM o nosso Bearer.
 * Mandar o Authorization junto de uma URL pré-assinada faz alguns provedores
 * recusarem a requisição.
 */
async function baixarPorUrlAssinada(
  url: string,
): Promise<{ body: Record<string, unknown>; diag: DownloadDiag }> {
  let res: Response;
  try {
    res = await withTimeout((signal) => fetch(url, { method: "GET", signal }));
  } catch (error) {
    throw transporte(error, "download");
  }
  const text = await res.text();
  const body = corpoJson(text);
  const diag: DownloadDiag = {
    status: res.status,
    ok: res.ok,
    caminho_token: "guardado",
    headers: headersDiag(res),
    em: new Date().toISOString(),
  };
  if (!res.ok || !body) {
    // A URL some do recorte: ela É a credencial do download.
    diag.corpo_recorte = text.slice(0, 1000);
    const err = (res.ok
      ? new ApuracaoGatewayError("error", "A Receita devolveu um corpo inesperado.")
      : erroDaReceita(res.status, body)) as ApuracaoGatewayError & { diag?: DownloadDiag };
    err.diag = diag;
    throw err;
  }
  return { body, diag };
}
```

E, em `processarApuracao`, antes do caminho do tíquete: se a linha tiver `url_assinada` e `url_assinada_expira_em` ainda no futuro, usar `baixarPorUrlAssinada`. Caso contrário, seguir o caminho atual.

- [ ] **Passo 8: typecheck, lint, build, testes**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/lib/rtc-v2
npx vite build
```

- [ ] **Passo 9: commit**

```bash
git add src/lib/rtc-v2/retorno.ts src/lib/rtc-v2/retorno.test.ts db/migrations/0225_apuracao_url_assinada.sql src/lib/rtc-apuracao.server.ts src/routes/api/public/rtc.apuracao.\$ref.tsx
git commit -m "Aceita urlAssinada da v2 no retorno e baixa por ela"
```

---

### Tarefa 3: Acompanhar pela consulta de situação

Esta é a que mais reduz risco. Hoje, se o nosso endereço não for alcançável — ambiente de teste, firewall, domínio trocado — o pedido se perde e a chamada é gasta. A v2 tem um endereço de acompanhamento que devolve a mesma `urlAssinada` **sem depender do retorno chegar**.

**Arquivos:**
- Criar: `src/lib/rtc-v2/enderecos.ts`, `src/lib/rtc-v2/enderecos.test.ts`
- Modificar: `src/lib/rtc-apuracao.server.ts`

**Interfaces:**
- Consome: `lerRetorno` da Tarefa 2 (a resposta de `situacao` tem os mesmos campos).
- Produz: `urlRecurso(base, ambiente, recurso, cnpj8)` e `urlSituacao(base, ambiente, tiquete)`;
  `type Ambiente = "producao" | "restrita"`; `type Recurso = "debitos" | "creditos" | "pagamentos" | "recolhimentos"`.
  E em `rtc-apuracao.server.ts`: `consultarSituacao(tiquete, token): Promise<Retorno & { estado: string }>`.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// src/lib/rtc-v2/enderecos.test.ts
import { describe, expect, it } from "vitest";
import { urlRecurso, urlSituacao } from "./enderecos";

const BASE = "https://api.receitafederal.gov.br";

describe("endereços da v2", () => {
  it("monta produção e produção restrita com o caminho certo", () => {
    expect(urlRecurso(BASE, "producao", "debitos", "23813386")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs/v2/debitos/23813386",
    );
    expect(urlRecurso(BASE, "restrita", "debitos", "23813386")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs-prr/v2/debitos/23813386",
    );
  });

  it("atende os quatro recursos", () => {
    for (const r of ["debitos", "creditos", "pagamentos", "recolhimentos"] as const) {
      expect(urlRecurso(BASE, "producao", r, "23813386")).toContain(`/v2/${r}/`);
    }
  });

  it("monta a consulta de situação", () => {
    expect(urlSituacao(BASE, "producao", "T-1")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs/v2/situacao/T-1",
    );
  });

  it("normaliza o CNPJ para os 8 primeiros dígitos", () => {
    expect(urlRecurso(BASE, "producao", "debitos", "23.813.386/0001-56")).toContain("/23813386");
  });

  it("escapa o tíquete na URL", () => {
    expect(urlSituacao(BASE, "producao", "a/b c")).toContain("a%2Fb%20c");
  });

  it("tira a barra sobrando da base", () => {
    expect(urlRecurso(`${BASE}/`, "producao", "debitos", "23813386")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs/v2/debitos/23813386",
    );
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run src/lib/rtc-v2/enderecos.test.ts`
Esperado: FAIL — módulo não encontrado.

- [ ] **Passo 3: implementar o mínimo**

```ts
// src/lib/rtc-v2/enderecos.ts
/**
 * Na v1 o ambiente era um prefixo (`rtc` / `prr-rtc`) antes do recurso. Na v2
 * ele faz parte do próprio caminho: `apuracao-cbs` ou `apuracao-cbs-prr`.
 * Trocar um pelo outro manda o pedido para o ambiente errado e queima uma das
 * 4 chamadas do dia — por isso isto é função pura, com teste.
 */
export type Ambiente = "producao" | "restrita";
export type Recurso = "debitos" | "creditos" | "pagamentos" | "recolhimentos";

const SEGMENTO: Record<Ambiente, string> = {
  producao: "apuracao-cbs",
  restrita: "apuracao-cbs-prr",
};

function raiz(base: string, ambiente: Ambiente): string {
  return `${base.replace(/\/+$/, "")}/${SEGMENTO[ambiente]}/v2`;
}

export function urlRecurso(base: string, ambiente: Ambiente, recurso: Recurso, cnpj: string) {
  const cnpj8 = cnpj.replace(/\D/g, "").slice(0, 8).padStart(8, "0");
  return `${raiz(base, ambiente)}/${recurso}/${cnpj8}`;
}

export function urlSituacao(base: string, ambiente: Ambiente, tiquete: string) {
  return `${raiz(base, ambiente)}/situacao/${encodeURIComponent(tiquete)}`;
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `npx vitest run src/lib/rtc-v2/enderecos.test.ts`
Esperado: PASS (6 testes).

- [ ] **Passo 5: implementar a consulta de situação no transporte**

Em `src/lib/rtc-apuracao.server.ts`:

```ts
/**
 * Acompanha a solicitação sem depender do webhook. Este endereço NÃO entra no
 * limite de 4 chamadas por dia — o limite é do endpoint de abertura. É o
 * caminho principal de recuperação quando o retorno não chega.
 */
export async function consultarSituacao(
  tiquete: string,
  token: string,
): Promise<{ estado: string; retorno: Retorno }> {
  const base = apiBase();
  if (!base) {
    throw new ApuracaoGatewayError("not_configured", "Ambiente sem endereço da API da Receita.");
  }
  const url = urlSituacao(base, ambienteAtual(), tiquete);
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal,
      }),
    );
  } catch (error) {
    throw transporte(error, "situacao");
  }
  const body = corpoJson(await res.text());
  if (!res.ok) throw erroDaReceita(res.status, body);
  const estado = String((body?.["estado"] as string | undefined) ?? "DESCONHECIDO");
  return { estado, retorno: lerRetorno(body) };
}
```

E `ambienteAtual()`, lendo a variável de ambiente já existente:

```ts
/** `RTC_API_PREFIX` valia na v1; na v2 vira a escolha do caminho. */
function ambienteAtual(): Ambiente {
  const raw = (process.env["RTC_API_PREFIX"] ?? "").trim();
  return raw.startsWith("prr") ? "restrita" : "producao";
}
```

- [ ] **Passo 6: usar situação no botão de recuperação, com prazo e espaçamento**

`processarPendentes` hoje só tenta baixar tíquetes que já chegaram. Passa a, para linhas em `solicitada` com `tiquete_solicitacao` preenchido e sem `url_assinada`, consultar a situação primeiro. Três regras, todas vindas da documentação:

1. **`CONCLUIDA`** → gravar `urlAssinada` e `urlAssinadaExpiraEm`, seguir para o download.
2. **`ERRO`** → marcar o erro com `codigoErro` e `mensagemErro`.
3. **`PENDENTE` / `EM_PROCESSAMENTO`** → não fazer nada ainda, mas **marcar erro por prazo** se `solicitado_em` já passou de **240 minutos**: é o teto de processamento da Receita, e sem isto a linha fica pendente para sempre.

```ts
const PRAZO_MS = 240 * 60 * 1000; // 240 minutos — teto de processamento da v2

if (estado === "PENDENTE" || estado === "EM_PROCESSAMENTO") {
  const idade = Date.now() - new Date(String(row.solicitado_em)).getTime();
  if (idade > PRAZO_MS) {
    await marcarErro(admin, row.id, "A Receita passou dos 240 minutos de processamento.");
  }
  return;
}
```

**Espaçamento da primeira consulta.** A resposta 201 da abertura traz `tEASegundos` — o tempo estimado de atendimento. Guardar esse valor na linha (coluna `tea_segundos int`, incluída na migration da Tarefa 4) e só consultar a situação depois que ele tiver passado. Consultar antes disso é chamada garantidamente inútil; `situacao` não entra na cota de 4, mas gasta tempo e ruído de log.

- [ ] **Passo 7: typecheck, lint, build, testes**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/lib/rtc-v2
npx vite build
```

- [ ] **Passo 8: commit**

```bash
git add src/lib/rtc-v2/enderecos.ts src/lib/rtc-v2/enderecos.test.ts src/lib/rtc-apuracao.server.ts
git commit -m "Acompanha a solicitacao pela consulta de situacao, sem depender do webhook"
```

---

### Tarefa 4: Abrir solicitação v2 por recurso

Junta as três anteriores: abrir a solicitação no endereço v2, com a `urlRetorno` que já responde ao HEAD, guardando o tíquete para o acompanhamento.

**Arquivos:**
- Modificar: `src/lib/rtc-apuracao.server.ts`
- Migration: `db/migrations/0226_apuracao_recurso_versao.sql`

**Interfaces:**
- Consome: `urlRecurso`, `Ambiente`, `Recurso` (Tarefa 3); `refValido` (Tarefa 1).
- Produz: `abrirSolicitacaoV2(tenantId, recurso, origin, origem)` com o mesmo tipo de retorno de `solicitarApuracao`.

- [ ] **Passo 1: migration — marcar recurso e versão na linha**

```sql
-- 0226_apuracao_recurso_versao.sql — ESPELHO da migration aplicada no banco.
-- Uma linha de rtc_apuracao passa a saber de qual recurso e de qual versão da
-- API ela veio. Sem isto, débitos e créditos da v2 ficam indistinguíveis na
-- mesma tabela, e o leitor não sabe qual formato aplicar.
alter table public.rtc_apuracao
  add column if not exists recurso text not null default 'debitos',
  add column if not exists api_versao smallint not null default 1,
  add column if not exists tea_segundos int;

comment on column public.rtc_apuracao.tea_segundos is
  'Tempo estimado de atendimento devolvido no 201 da abertura v2. Usado para so consultar a situacao depois que ele passar.';

alter table public.rtc_apuracao
  drop constraint if exists rtc_apuracao_recurso_ck;
alter table public.rtc_apuracao
  add constraint rtc_apuracao_recurso_ck
  check (recurso in ('debitos','creditos','pagamentos','recolhimentos'));
```

- [ ] **Passo 2: conferir no banco (pós-voo)**

```sql
select column_name, column_default from information_schema.columns
 where table_schema='public' and table_name='rtc_apuracao'
   and column_name in ('recurso','api_versao');
```
Esperado: `recurso` com default `'debitos'`, `api_versao` com default `1`.

- [ ] **Passo 3: estender a RPC de abertura**

`rtc_apuracao_solicitar` ganha `p_recurso text default 'debitos'` e `p_api_versao smallint default 1`, grava as duas colunas e mantém o débito de cota. **A cota passa a ser 4 quando `p_api_versao = 2`** — ajustar `rtc_quota_take` para receber o limite, ou criar `rtc_quota_take(cnpj, kind, origem, limite)`. Conferir o limite atual antes de alterar:

```sql
select pg_get_functiondef(oid) from pg_proc
 where proname = 'rtc_quota_take' and pronamespace = 'public'::regnamespace;
```

- [ ] **Passo 4: implementar a abertura v2 no transporte**

`abrirSolicitacaoV2` repete `solicitarApuracao`, trocando só a montagem da URL (`urlRecurso(base, ambienteAtual(), recurso, cnpj)`) e guardando `tiqueteSolicitacao` da resposta 201. **Não** remover `solicitarApuracao`: a v1 segue viva.

- [ ] **Passo 5: verificar com servidor de mentira**

Escrever `src/lib/rtc-v2/abertura.test.ts` que sobe um servidor local com `node:http`, aponta `RTC_API_URL` para ele, e confirma: (a) a URL chamada é a do recurso certo; (b) o corpo tem `urlRetorno` e nada mais; (c) o header `Authorization` começa com `Bearer `; (d) o `tiqueteSolicitacao` do 201 é guardado.

- [ ] **Passo 6: typecheck, lint, build, testes**

- [ ] **Passo 7: commit**

```bash
git commit -m "Abre solicitacao na v2 por recurso, com cota de 4 por dia"
```

---

### Tarefa 5: Ler o formato v2 de débitos e créditos

**PORTÃO:** esta tarefa é escrita contra o esquema publicado. Débitos e créditos têm **estrutura idêntica** — um leitor serve os dois. Quando o primeiro arquivo real chegar, **reconferir campo a campo antes de confiar**: nomes, se `cbs` vem como objeto ou lista, escala dos valores, e o vocabulário de `origem` e `documento`. A regra do projeto é conferir contra o JSON recebido, não contra o manual.

**Arquivos:**
- Criar: `src/lib/rtc-v2/valores.ts`, `src/lib/rtc-v2/valores.test.ts`
- Criar: `src/lib/rtc-v2/debitos.ts`, `src/lib/rtc-v2/debitos.test.ts`

**Interfaces:**
- Produz: `reaisParaCentavos(v: unknown): number` e
  `lerDebitosV2(arquivo: unknown): { pa: string; chave: string; origem: number; documento: number; emissao: string | null; registro: string | null; atualizacao: string | null; apurado_cents: number; excedente_cents: number; inexigivel_cents: number; suspenso_cents: number; extinto_cents: number; saldo_devedor_cents: number }[]`

- [ ] **Passo 1: teste da conversão de valor — a armadilha mais cara**

```ts
// src/lib/rtc-v2/valores.test.ts
import { describe, expect, it } from "vitest";
import { reaisParaCentavos } from "./valores";

describe("reais para centavos", () => {
  it("converte sem erro de ponto flutuante", () => {
    // 18.29 * 100 dá 1828.9999999999998 em ponto flutuante.
    expect(reaisParaCentavos(18.29)).toBe(1829);
    expect(reaisParaCentavos(1.005)).toBe(100); // trunca o terceiro decimal
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30);
  });

  it("aceita texto, que é como o JSON pode trazer", () => {
    expect(reaisParaCentavos("18.29")).toBe(1829);
    expect(reaisParaCentavos("1234567890123456.78")).toBe(123456789012345678);
  });

  it("trata ausência como zero, nunca como NaN", () => {
    expect(reaisParaCentavos(undefined)).toBe(0);
    expect(reaisParaCentavos(null)).toBe(0);
    expect(reaisParaCentavos("")).toBe(0);
    expect(reaisParaCentavos("abc")).toBe(0);
  });

  it("preserva o sinal", () => {
    expect(reaisParaCentavos(-18.29)).toBe(-1829);
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rodar: `npx vitest run src/lib/rtc-v2/valores.test.ts` — FAIL.

- [ ] **Passo 3: implementar a conversão por texto**

```ts
// src/lib/rtc-v2/valores.ts
/**
 * A v2 manda `number(18,2)` em reais; o banco guarda centavos em bigint.
 * A conversão é feita por TEXTO, nunca por `valor * 100`: em ponto flutuante
 * `18.29 * 100` é 1828.9999999999998, e um centavo perdido por documento vira
 * divergência com a Receita na soma da apuração.
 */
export function reaisParaCentavos(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const bruto = typeof v === "number" ? v.toFixed(2) : String(v).trim();
  if (!bruto) return 0;
  const m = /^(-?)(\d+)(?:[.,](\d*))?$/.exec(bruto);
  if (!m) return 0;
  const [, sinal, inteira, decimal = ""] = m;
  const centavos = `${decimal}00`.slice(0, 2);
  const total = Number(`${inteira}${centavos}`);
  if (!Number.isSafeInteger(total)) return 0;
  return sinal === "-" ? -total : total;
}
```

- [ ] **Passo 4: rodar e confirmar que passa** — PASS (4 testes).

- [ ] **Passo 5: teste do leitor de débitos**

```ts
// src/lib/rtc-v2/debitos.test.ts
import { describe, expect, it } from "vitest";
import { lerDebitosV2 } from "./debitos";

const ARQUIVO = {
  tiqueteSolicitacao: "T-1",
  ni: "23813386",
  geradoEm: "2026-10-02T12:00:00Z",
  apuracao: [
    {
      pa: "09/2026",
      debitos: [
        {
          origem: 0,
          documento: 55,
          chave: "3526".padEnd(44, "9"),
          emissao: "2026-09-10T08:00:00Z",
          registro: "2026-09-10T08:10:00Z",
          atualizacao: "2026-09-11T08:10:00Z",
          cbs: { apurado: 18.29, extinto: 10.0, saldoDevedor: 8.29 },
        },
      ],
    },
  ],
};

describe("leitor de débitos v2", () => {
  it("achata apuracao[].debitos[] em linhas com o pa junto", () => {
    const linhas = lerDebitosV2(ARQUIVO);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      pa: "09/2026",
      origem: 0,
      documento: 55,
      apurado_cents: 1829,
      extinto_cents: 1000,
      saldo_devedor_cents: 829,
    });
  });

  it("trata os campos opcionais de cbs como zero", () => {
    const linhas = lerDebitosV2(ARQUIVO);
    expect(linhas[0]?.excedente_cents).toBe(0);
    expect(linhas[0]?.inexigivel_cents).toBe(0);
    expect(linhas[0]?.suspenso_cents).toBe(0);
  });

  it("lê vários períodos no mesmo arquivo", () => {
    const dois = {
      ...ARQUIVO,
      apuracao: [ARQUIVO.apuracao[0], { ...ARQUIVO.apuracao[0], pa: "08/2026" }],
    };
    expect(lerDebitosV2(dois).map((l) => l.pa)).toEqual(["09/2026", "08/2026"]);
  });

  it("devolve lista vazia para arquivo vazio ou malformado, sem lançar", () => {
    expect(lerDebitosV2({})).toEqual([]);
    expect(lerDebitosV2(null)).toEqual([]);
    expect(lerDebitosV2({ apuracao: "nao e lista" })).toEqual([]);
    expect(lerDebitosV2({ apuracao: [{ pa: "09/2026" }] })).toEqual([]);
  });

  it("aceita a chave como número sem perder dígito", () => {
    // Um `chNFe` que veio como número já custou uma rodada no passado.
    const comNumero = {
      ...ARQUIVO,
      apuracao: [{ pa: "09/2026", debitos: [{ ...ARQUIVO.apuracao[0].debitos[0], chave: 35269 }] }],
    };
    expect(lerDebitosV2(comNumero)[0]?.chave).toBe("35269");
  });
});
```

- [ ] **Passo 6: rodar e confirmar que falha** — FAIL.

- [ ] **Passo 7: implementar o leitor**

```ts
// src/lib/rtc-v2/debitos.ts
import { reaisParaCentavos } from "./valores";

/**
 * Achata o arquivo v2 (`apuracao[].debitos[]`) em linhas, carregando o período
 * de apuração para dentro de cada uma. Créditos têm estrutura IDÊNTICA — a
 * única diferença é o nome da lista — por isso a função recebe qual ler.
 *
 * Nada aqui decide valor fiscal: só transporta o que veio, convertendo escala.
 */
export type LinhaV2 = {
  pa: string;
  chave: string;
  origem: number;
  documento: number;
  emissao: string | null;
  registro: string | null;
  atualizacao: string | null;
  apurado_cents: number;
  excedente_cents: number;
  inexigivel_cents: number;
  suspenso_cents: number;
  extinto_cents: number;
  saldo_devedor_cents: number;
};

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function texto(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  // A chave pode chegar como número: converter sem notação científica.
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v)).toString();
  return null;
}
function inteiro(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : -1;
}

export function lerListaV2(arquivo: unknown, chaveLista: "debitos" | "creditos"): LinhaV2[] {
  const out: LinhaV2[] = [];
  for (const grupoBruto of lista(obj(arquivo)["apuracao"])) {
    const grupo = obj(grupoBruto);
    const pa = texto(grupo["pa"]);
    if (!pa) continue;
    for (const itemBruto of lista(grupo[chaveLista])) {
      const item = obj(itemBruto);
      const chave = texto(item["chave"]);
      if (!chave) continue;
      const cbs = obj(item["cbs"]);
      out.push({
        pa,
        chave,
        origem: inteiro(item["origem"]),
        documento: inteiro(item["documento"]),
        emissao: texto(item["emissao"]),
        registro: texto(item["registro"]),
        atualizacao: texto(item["atualizacao"]),
        apurado_cents: reaisParaCentavos(cbs["apurado"]),
        excedente_cents: reaisParaCentavos(cbs["excedente"]),
        inexigivel_cents: reaisParaCentavos(cbs["inexigivel"]),
        suspenso_cents: reaisParaCentavos(cbs["suspenso"]),
        extinto_cents: reaisParaCentavos(cbs["extinto"]),
        saldo_devedor_cents: reaisParaCentavos(cbs["saldoDevedor"]),
      });
    }
  }
  return out;
}

export const lerDebitosV2 = (arquivo: unknown) => lerListaV2(arquivo, "debitos");
export const lerCreditosV2 = (arquivo: unknown) => lerListaV2(arquivo, "creditos");
```

- [ ] **Passo 8: rodar e confirmar que passa** — PASS (5 testes).

- [ ] **Passo 9: espelhar o teste para créditos**

Copiar `debitos.test.ts` para `creditos.test.ts`, trocando a lista por `creditos` e a função por `lerCreditosV2`. Repetir o código do arquivo de exemplo — não referenciar o outro teste.

- [ ] **Passo 10: typecheck, lint, build, testes; commit**

```bash
git commit -m "Le o formato v2 de debitos e creditos, com conversao de valor por texto"
```

---

### Tarefa 6: Acumular o incremental sem perder dado

**PORTÃO:** depende de a Tarefa 5 ter sido reconferida contra arquivo real.

O ponto que muda o produto: cada chamada traz **só o que mudou**, janela máxima de **8 dias**. Passar mais de 8 dias sem consultar **perde o intervalo, sem meio de recuperar de uma vez**. Portanto: acumular por chave natural, e consultar por rotina.

**Arquivos:**
- Migration: `db/migrations/0227_rtc_posicao_incremental.sql`
- Modificar: `src/lib/rtc-apuracao.server.ts`

- [ ] **Passo 1: confirmar a chave natural contra dado real — antes de criar índice único**

A chave presumida é `(tenant_id, recurso, pa, chave, origem)`. **Presumida, não confirmada:** um mesmo documento pode aparecer com mais de uma `origem` no mesmo período, e não está dito se pode repetir com a mesma `origem`. Rodar contra o primeiro arquivo real:

```sql
-- Espera-se zero linhas. Qualquer linha aqui derruba a chave presumida.
select pa, chave, origem, count(*)
  from jsonb_to_recordset(...) as t(pa text, chave text, origem int)
 group by 1,2,3 having count(*) > 1;
```

Só criar a restrição única depois que isto voltar vazio.

- [ ] **Passo 2: migration da tabela de posição e da acumulação**

```sql
-- 0227_rtc_posicao_incremental.sql — ESPELHO da migration aplicada no banco.
--
-- A v2 é incremental: cada consulta traz só o que mudou desde a anterior, com
-- janela máxima de 8 dias. Duas consequências desenhadas aqui:
--   1. os dados são ACUMULADOS por chave natural (upsert), nunca substituídos;
--   2. guardamos quando foi a última consulta por recurso, para a rotina saber
--      de quem está chegando perto dos 8 dias.
create table if not exists public.rtc_posicao (
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  recurso        text not null,
  ultima_consulta timestamptz,
  ultimo_tiquete  text,
  atualizado_em   timestamptz not null default now(),
  primary key (tenant_id, recurso),
  constraint rtc_posicao_recurso_ck
    check (recurso in ('debitos','creditos','pagamentos','recolhimentos'))
);

alter table public.rtc_posicao enable row level security;

create policy rtc_posicao_read on public.rtc_posicao
  for select to authenticated using (in_scope(tenant_id));

-- Escrita só por service role / função SECURITY DEFINER: fail-closed explícito,
-- no mesmo padrão de receivables na 0222.
create policy rtc_posicao_no_write on public.rtc_posicao
  for all to authenticated using (false) with check (false);

revoke all on public.rtc_posicao from anon;
revoke insert, update, delete, truncate on public.rtc_posicao from authenticated;
grant select on public.rtc_posicao to authenticated;
grant all on public.rtc_posicao to service_role;
```

- [ ] **Passo 3: conferir no banco (pós-voo)**

```sql
select relrowsecurity from pg_class where oid = 'public.rtc_posicao'::regclass;
select array_to_string(relacl,' | ') from pg_class where oid = 'public.rtc_posicao'::regclass;
```
Esperado: RLS ligada; `authenticated` **sem** `w`, `d` nem `D`.

- [ ] **Passo 4: função de ingestão que acumula**

`rtc_v2_ingest(p_tenant uuid, p_recurso text, p_linhas jsonb)` faz upsert pela chave natural confirmada no Passo 1, grava `audit_log`, e atualiza `rtc_posicao.ultima_consulta`. Nunca apaga linha que não veio no incremento.

- [ ] **Passo 5: teste de acumulação**

Rodar duas ingestões seguidas no banco de desenvolvimento: a primeira com 2 documentos, a segunda com 1 deles atualizado e 1 novo. Esperado: 3 linhas no total, a repetida com o valor novo, nenhuma perdida.

- [ ] **Passo 6: aviso de janela**

Na tela, quando `now() - ultima_consulta > 6 dias`, mostrar aviso de que faltam menos de 2 dias para a janela de 8 fechar. Texto no balão de ajuda, não solto na tela (regra do prose-guard).

- [ ] **Passo 7: typecheck, lint, build, testes; commit**

---

### Tarefa 7: Pagamentos e recolhimentos

**PORTÃO:** só a partir de novembro/2026, quando a Receita liberar. **Estrutura diferente** da de débitos/créditos — não reaproveitar o leitor da Tarefa 5.

O arquivo agrupa por `dataArrecadacao`, e dentro vem `pagamentos[]` com `numeroDARF`, `tipo` e uma lista `composicao[]` que carrega `sequencial`, `pa`, `vencimento`, `chaveDFE`, `principal`, `multa`, `juros`, `total`.

Duas diferenças que quebram um leitor descuidado:
- A chave do documento aqui se chama **`chaveDFE`**, não `chave`.
- Em **pagamentos** a contraparte é `niAdquirente`; em **recolhimentos** é `niFornecedor`. O resto é igual, inclusive a lista continuar se chamando `pagamentos[]` nos dois.

- [ ] **Passo 1:** escrever `src/lib/rtc-v2/arrecadacao.test.ts` com exemplo de cada um dos dois recursos, cobrindo: achatamento por `dataArrecadacao` + `composicao`, conversão de `principal`/`multa`/`juros`/`total` por `reaisParaCentavos`, e o nome da contraparte conforme o recurso.
- [ ] **Passo 2:** rodar e confirmar que falha.
- [ ] **Passo 3:** implementar `lerArrecadacaoV2(arquivo, recurso)`.
- [ ] **Passo 4:** rodar e confirmar que passa.
- [ ] **Passo 5:** reconferir contra arquivo real antes de ligar na tela.
- [ ] **Passo 6:** typecheck, lint, build, testes; commit.

---

## Ordem e dependências

```
Diogo: gerar credencial nova  ──┐
                                 ├─→ prova de ponta a ponta na v1
Tarefa 1 (HEAD) ─────────────────┤
Tarefa 2 (urlAssinada) ──────────┤
Tarefa 3 (situação) ─────────────┴─→ Tarefa 4 (abrir v2)
                                            │
                        outubro: dado real  ▼
                                      Tarefa 5 (ler v2) → Tarefa 6 (acumular)
                                            │
                        novembro: dado real ▼
                                      Tarefa 7 (arrecadação)
```

As tarefas 1 a 4 não dependem da credencial nem de outubro: são transporte, e se verificam com servidor de mentira. Podem começar hoje.

## Revisão contra a documentação

- **Validação HEAD** → Tarefa 1 ✅
- **`urlRetorno` no corpo** → já correto no código; coberto na Tarefa 4 ✅
- **`urlAssinada` / `urlAssinadaExpiraEm` / 48 h** → Tarefa 2 ✅
- **`codigoErro` / `mensagemErro`** → Tarefa 2 ✅
- **Caminhos `apuracao-cbs` e `apuracao-cbs-prr`, `/v2/{recurso}/`** → Tarefa 3 ✅
- **`situacao` com 4 estados, devolve `urlAssinada`** → Tarefa 3 ✅
- **4 chamadas/dia na abertura** → Tarefa 4 ✅
- **240 minutos de prazo** → Tarefa 3, passo 6 ✅
- **Esquema de débitos e créditos** → Tarefa 5 ✅
- **Janela incremental de 8 dias** → Tarefa 6 ✅
- **Esquema de pagamentos e recolhimentos** → Tarefa 7 ✅
- **`tEASegundos` do 201** → Tarefa 3, passo 6 (espaçamento da primeira consulta) e migration da Tarefa 4 ✅
