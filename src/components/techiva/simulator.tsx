import { AlertTriangle, BookOpen, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import { Semaphore } from "@/components/techiva/badges";
import { Panel } from "@/components/techiva/page";
import { formatCents } from "@/components/techiva/money";
import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";
import {
  MOTOR_OFICIAL,
  engineUnavailableMessage,
  type CalcResult,
  type EngineStatus,
  type TopIssue,
  type Tribute,
} from "@/lib/simulator";

/** As três frases do manual da RFB — o posicionamento fica onde o usuário vê. */
export function MotorOficialNote({ compact = false }: { compact?: boolean | undefined }) {
  return (
    <Panel title="Motor oficial da Receita Federal" icon={ShieldCheck}>
      <ul className="space-y-2 text-xs text-muted-foreground">
        {(compact ? MOTOR_OFICIAL.slice(0, 2) : MOTOR_OFICIAL).map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Semaphore level="ok" showLabel={false} className="mt-1 shrink-0" />
            {line}
          </li>
        ))}
      </ul>
    </Panel>
  );
}


/**
 * Estado do motor. Quando indisponível, esta é a ÚNICA coisa que a tela mostra
 * no lugar de números — jamais um valor estimado.
 */
export function EngineBanner({
  status,
  loading,
  message,
}: {
  status: EngineStatus | undefined;
  loading?: boolean | undefined;
  message?: string | null | undefined;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Verificando a calculadora oficial…
      </p>
    );
  }
  if (!status) return null;

  if (status.dev_stub) {
    return (
      <div className="rounded-xl border border-flow-out/40 bg-flow-out/10 p-4 text-xs">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="size-3.5 text-flow-out" aria-hidden />
          Modo de desenvolvimento — sem motor oficial
        </p>
        <p className="mt-1 text-muted-foreground">
          Nenhum valor exibido tem validade fiscal. Este modo é proibido em produção.
        </p>
      </div>
    );
  }

  if (!status.available) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-flow-out/40 bg-flow-out/10 p-4 text-sm"
      >
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="size-4 text-flow-out" aria-hidden />
          Calculadora não disponível
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {message ?? engineUnavailableMessage(status.reason)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Preferimos não mostrar número nenhum a mostrar número que não veio do motor oficial.
        </p>
      </div>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <CheckCircle2 className="size-3.5 text-flow-in" aria-hidden />
      Calculadora oficial conectada
      {status.calc_version && (
        <Badge variant="outline" className="font-mono text-[10px]">
          {status.calc_version}
        </Badge>
      )}
    </p>
  );
}

function TributeRow({ label, tribute }: { label: string; tribute: Tribute }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          Alíquota:{" "}
          <span className="font-mono">
            {tribute.aliquota_pct === null ? "—" : `${tribute.aliquota_pct.toFixed(2)}%`}
          </span>{" "}
          · Redução:{" "}
          <span className="font-mono">
            {tribute.reducao_pct === null ? "—" : `${tribute.reducao_pct.toFixed(2)}%`}
          </span>
        </p>
      </div>
      <span className="font-mono text-sm tabular-nums">{formatCents(tribute.valor_cents)}</span>
    </div>
  );
}

/** Resultado do motor: CBS, IBS estadual, IBS municipal e IS separados. */
export function CalcResultPanel({ result }: { result: CalcResult }) {
  return (
    <div className="space-y-4">
      {result.source === "dev-stub" && (
        <p className="rounded-lg border border-flow-out/40 bg-flow-out/10 p-3 text-xs">
          Valores zerados de propósito: este ambiente não tem o motor oficial.
        </p>
      )}
      {/* mesmo padrão do Preço de venda: número principal no herói, memória logo abaixo */}
      <Panel className="panel-hero" title="Resultado do cálculo">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">Total da operação</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-[-0.02em] sm:text-4xl">
              {formatCents(result.total_operacao_cents)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Base{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatCents(result.base_cents)}
              </span>{" "}
              · tributos{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatCents(result.tributo_total_cents)}
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-surface-1/60 p-4">
            <TributeRow label="CBS" tribute={result.cbs} />
            <TributeRow label="IBS estadual" tribute={result.ibs_estadual} />
            <TributeRow label="IBS municipal" tribute={result.ibs_municipal} />
            <TributeRow label="Imposto Seletivo (IS)" tribute={result.imposto_seletivo} />
          </div>

          <CalcMemoryPanel memory={result.memory} version={result.calc_version} />
        </div>
      </Panel>
    </div>
  );
}

/** Memória de cálculo expandível: passos e base legal, como no motor oficial. */
export function CalcMemoryPanel({
  memory,
  version,
}: {
  memory: CalcResult["memory"];
  version: string | null;
}) {
  return (
    <details className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
      <summary className="cursor-pointer text-sm font-semibold">
        <span className="inline-flex items-center gap-2">
          <BookOpen className="size-4 text-primary" aria-hidden />
          Memória de cálculo e base legal
        </span>
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Versão da calculadora: <span className="font-mono">{version ?? memory.versao ?? "—"}</span>
      </p>
      {memory.passos.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          O motor não devolveu passos para esta operação.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {memory.passos.map((p, i) => (
            <li key={`${p.passo}-${i}`} className="rounded-lg border border-border/60 p-3 text-xs">
              <p className="font-medium">
                {i + 1}. {p.passo}
              </p>
              {p.descricao && <p className="mt-1 text-muted-foreground">{p.descricao}</p>}
              <p className="mt-1 font-mono text-muted-foreground">
                {p.valor_cents !== undefined && <>valor {formatCents(p.valor_cents)} </>}
                {p.aliquota_pct !== undefined && <>· alíquota {p.aliquota_pct.toFixed(2)}% </>}
                {p.reducao_pct !== undefined && <>· redução {p.reducao_pct.toFixed(2)}%</>}
              </p>
              {p.base_legal && (
                <p className="mt-1 text-muted-foreground">
                  Base legal: <span className="font-medium text-foreground">{p.base_legal}</span>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {memory.base_legal && (
        <p className="mt-3 text-xs text-muted-foreground">
          Fundamento geral: <span className="font-medium text-foreground">{memory.base_legal}</span>
        </p>
      )}
    </details>
  );
}

/** "Seus erros recorrentes" — o valor real do validador. */
export function TopIssuesPanel({
  issues,
  loading,
}: {
  issues: TopIssue[] | undefined;
  loading?: boolean | undefined;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Carregando ranking…</p>;
  }
  if (!issues || issues.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma inconsistência registrada no período. Valide alguns XML para ver o padrão.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {issues.map((issue) => (
        <li
          key={issue.codigo}
          className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border/60 p-3 text-xs"
        >
          <div className="min-w-0">
            <p className="font-medium">
              <code className="font-mono">{issue.codigo}</code> — {issue.descricao ?? "sem descrição"}
            </p>
            <p className="text-muted-foreground">
              {issue.ocorrencias} ocorrência(s) em {issue.documentos} documento(s) · último em{" "}
              {new Date(issue.ultimo).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <Badge variant="outline" className="font-mono">
            {issue.ocorrencias}×
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Impressão da simulação em PDF pelo diálogo do navegador. */
export function PrintButton({ label = "Exportar PDF" }: { label?: string | undefined }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
