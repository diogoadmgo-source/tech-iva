import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  Table2,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BASE_LABEL, n, since } from "@/lib/tax-intel/labels";
import {
  isActive,
  loadProcessingStatus,
  phaseOf,
  ProcessingRefused,
  requestProcessing,
  type Phase,
} from "@/lib/tax-intel/processing";
import { cn } from "@/lib/utils";

type StepState = "feito" | "atual" | "rodando" | "bloqueado" | "erro";

/**
 * Jornada da Base de CNPJs em três passos: importar → processar → resultado.
 * O estado de cada passo vem do banco; o botão "Processar agora" aciona o motor
 * e o andamento atualiza sozinho enquanto ele trabalha.
 */
export function Journey({
  tenantId,
  cnpjs,
  pendentes,
  classificados,
  lastImportAt,
}: {
  tenantId: string;
  cnpjs: number;
  pendentes: number;
  classificados: number;
  lastImportAt: string | null;
}) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["tax-processing", tenantId],
    queryFn: () => loadProcessingStatus(tenantId),
    refetchInterval: (q) => (q.state.data && isActive(phaseOf(q.state.data)) ? 4_000 : 30_000),
  });
  const phase = phaseOf(status.data);
  const active = isActive(phase);

  // Quando o motor termina, recarrega os números da tela.
  const prev = useRef<Phase["kind"] | null>(null);
  useEffect(() => {
    if (prev.current && prev.current !== phase.kind && !active) {
      void qc.invalidateQueries({ queryKey: ["tax-overview", tenantId] });
      void qc.invalidateQueries({ queryKey: ["tax-portfolio", tenantId] });
      if (phase.kind === "concluido")
        toast.success("Processamento concluído. Os regimes foram atualizados.");
    }
    prev.current = phase.kind;
  }, [phase.kind, active, qc, tenantId]);

  const start = useMutation({
    mutationFn: () => requestProcessing(tenantId),
    onSuccess: () => {
      toast.success("Processamento iniciado. Acompanhe o andamento aqui.");
      void qc.invalidateQueries({ queryKey: ["tax-processing", tenantId] });
    },
    onError: (e) => {
      if (e instanceof ProcessingRefused && e.soft) toast.info(e.message);
      else toast.error((e as Error).message);
      void qc.invalidateQueries({ queryKey: ["tax-processing", tenantId] });
    },
  });

  const hasBase = cnpjs > 0;
  const canProcess = status.data?.pode_processar ?? false;
  const s2: StepState = !hasBase
    ? "bloqueado"
    : active || start.isPending
      ? "rodando"
      : phase.kind === "falhou"
        ? "erro"
        : phase.kind === "concluido" && pendentes === 0
          ? "feito"
          : "atual";
  const s3: StepState = classificados > 0 && !active ? "feito" : "bloqueado";

  return (
    <section aria-label="Passo a passo" className="panel-hero p-5 sm:p-6">
      <ol className="grid gap-5 lg:grid-cols-[1fr_1.5fr_1fr] lg:gap-0 [&>li]:min-w-0">
        <Step
          index={1}
          state={hasBase ? "feito" : "atual"}
          icon={Upload}
          title="Importar a base"
          last={false}
        >
          {hasBase ? (
            <>
              <p className="text-sm">
                <span className="font-mono tabular font-semibold">{n(cnpjs)}</span> CNPJs na base
              </p>
              {lastImportAt ? (
                <p className="text-xs text-muted-foreground">
                  Última importação {since(lastImportAt)}
                </p>
              ) : null}
              <Button asChild size="sm" variant="ghost" className="-ml-2 mt-1 h-7 px-2 text-xs">
                <Link to="/t/$tenantId/tributario/importacoes" params={{ tenantId }}>
                  <Upload className="mr-1.5 size-3.5" aria-hidden /> Importar mais
                </Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Planilha XLSX ou CSV com os CNPJs.</p>
              <Button asChild size="sm" className="cta-lift mt-2">
                <Link to="/t/$tenantId/tributario/importacoes" params={{ tenantId }}>
                  <Upload className="mr-2 size-4" aria-hidden /> Importar base
                </Link>
              </Button>
            </>
          )}
        </Step>

        <Step index={2} state={s2} icon={Zap} title="Processar" last={false}>
          {status.isLoading ? (
            <Skeleton className="h-16" />
          ) : (
            <ProcessBody
              phase={phase}
              pendentes={pendentes}
              hasBase={hasBase}
              canProcess={canProcess}
              pending={start.isPending}
              onStart={() => start.mutate()}
            />
          )}
        </Step>

        <Step index={3} state={s3} icon={Download} title="Baixar o resultado" last>
          {s3 === "feito" ? (
            <>
              <p className="text-sm">
                <span className="font-mono tabular font-semibold">{n(classificados)}</span> CNPJs
                com resultado
              </p>
              <p className="text-xs text-muted-foreground">
                Excel com regime, fonte e evidência de cada CNPJ.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild size="sm" className="cta-lift">
                  <Link
                    to="/t/$tenantId/tributario/carteira"
                    params={{ tenantId }}
                    search={{ exportar: true }}
                  >
                    <Download className="mr-2 size-4" aria-hidden /> Exportar Excel
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/t/$tenantId/tributario/carteira" params={{ tenantId }}>
                    <Table2 className="mr-2 size-4" aria-hidden /> Ver {BASE_LABEL}
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {active
                ? "Disponível assim que o processamento terminar."
                : "Liberado depois do primeiro processamento."}
            </p>
          )}
        </Step>
      </ol>
    </section>
  );
}

function ProcessBody({
  phase,
  pendentes,
  hasBase,
  canProcess,
  pending,
  onStart,
}: {
  phase: Phase;
  pendentes: number;
  hasBase: boolean;
  canProcess: boolean;
  pending: boolean;
  onStart: () => void;
}) {
  if (!hasBase) {
    return <p className="text-xs text-muted-foreground">Importe a base para liberar este passo.</p>;
  }

  if (pending) {
    return (
      <div role="status" className="space-y-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden /> Enviando ao motor…
        </p>
        <Bar pct={4} active />
      </div>
    );
  }

  if (phase.kind === "na_fila") {
    return (
      <div role="status" className="space-y-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium">
          Na fila
          <span className="proc-dots inline-flex gap-0.5" aria-hidden>
            <span className="size-1 rounded-full bg-primary" />
            <span className="size-1 rounded-full bg-primary" />
            <span className="size-1 rounded-full bg-primary" />
          </span>
        </p>
        <Bar pct={4} active />
        <p className="text-xs text-muted-foreground">
          Pedido {since(phase.desde)}. O motor começa em instantes.
        </p>
      </div>
    );
  }

  if (phase.kind === "rodando") {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden /> Cruzando com a
            Receita
          </p>
          <span className="font-mono tabular text-sm font-semibold">{phase.pct}%</span>
        </div>
        <Bar pct={Math.max(phase.pct, 4)} active />
        <p className="text-xs text-muted-foreground">
          {phase.arquivo ? `Lendo ${phase.arquivo} · ` : ""}iniciado {since(phase.desde)}. Pode
          fechar a tela: o processamento continua.
        </p>
      </div>
    );
  }

  const button = (
    <Button
      size="sm"
      onClick={onStart}
      disabled={!canProcess}
      variant={phase.kind === "concluido" && pendentes === 0 ? "outline" : "default"}
      className={cn(phase.kind !== "concluido" || pendentes > 0 ? "cta-lift" : "")}
    >
      {phase.kind === "falhou" ? (
        <RotateCcw className="mr-2 size-4" aria-hidden />
      ) : (
        <Play className="mr-2 size-4" aria-hidden />
      )}
      {phase.kind === "falhou"
        ? "Tentar de novo"
        : phase.kind === "concluido"
          ? "Processar de novo"
          : "Processar agora"}
    </Button>
  );

  return (
    <div className="space-y-2">
      {phase.kind === "concluido" ? (
        <p className="text-sm">
          Concluído {since(phase.em)}
          <span className="text-muted-foreground"> · dados da Receita de {phase.competencia}</span>
        </p>
      ) : phase.kind === "falhou" ? (
        <p className="inline-flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Não concluiu: {phase.motivo}</span>
        </p>
      ) : (
        <p className="text-sm">
          <span className="font-mono tabular font-semibold">{n(pendentes)}</span> CNPJs aguardando o
          cruzamento com a Receita
        </p>
      )}
      {phase.kind === "concluido" && pendentes > 0 ? (
        <p className="text-xs text-muted-foreground">
          {n(pendentes)} CNPJs entraram depois do último processamento.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {button}
        {!canProcess ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden /> Só administradores da empresa iniciam
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Atualiza sozinho todo dia às 6h30 quando a Receita publica dados novos.
          </span>
        )}
      </div>
    </div>
  );
}

function Bar({ pct, active }: { pct: number; active: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 overflow-hidden rounded-full bg-surface-2"
    >
      <div
        data-active={active}
        className="proc-bar h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Step({
  index,
  state,
  icon: Icon,
  title,
  last,
  children,
}: {
  index: number;
  state: StepState;
  icon: typeof Upload;
  title: string;
  last: boolean;
  children: ReactNode;
}) {
  const tone: Record<StepState, string> = {
    feito: "border-flow-in/50 bg-flow-in/10 text-flow-in",
    atual: "border-primary/60 bg-primary/10 text-primary",
    rodando: "border-primary/60 bg-primary/10 text-primary",
    bloqueado: "border-border bg-surface-2 text-muted-foreground",
    erro: "border-destructive/50 bg-destructive/10 text-destructive",
  };
  const label: Record<StepState, string> = {
    feito: "concluído",
    atual: "próximo passo",
    rodando: "em andamento",
    bloqueado: "aguardando",
    erro: "com erro",
  };
  return (
    <li
      className={cn(
        "relative flex gap-3 lg:px-5 lg:first:pl-0 lg:last:pr-0",
        !last && "lg:border-r lg:border-border/60",
        state === "bloqueado" && "opacity-75",
      )}
      aria-current={state === "atual" || state === "rodando" ? "step" : undefined}
    >
      <span
        className={cn(
          "relative grid size-9 shrink-0 place-items-center rounded-full border",
          tone[state],
          state === "rodando" && "proc-ring",
        )}
      >
        {state === "feito" ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Icon className="size-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          Passo {index} · {label[state]}
        </p>
        <p className="text-sm font-semibold">{title}</p>
        {children}
      </div>
    </li>
  );
}
