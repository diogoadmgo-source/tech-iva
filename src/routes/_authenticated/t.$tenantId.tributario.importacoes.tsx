import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Table2,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Dropzone } from "@/components/tax-intel/dropzone";
import { ModuleTabs } from "@/components/tax-intel/module-tabs";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { InfoHint } from "@/components/techiva/info-hint";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { Pager } from "@/components/techiva/pager";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Stepper } from "@/components/techiva/stepper";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { MemberRole } from "@/lib/auth";
import { formatCnpj } from "@/lib/tax-intel/cnpj";
import {
  cancelImport,
  resumeImport,
  runImport,
  taxFrom,
  type ImportProgress,
  type ImportRow,
  type ImportSummary,
} from "@/lib/tax-intel/import-client";
import { dateTime, n, pct, since } from "@/lib/tax-intel/labels";
import { buildPreview, type Preview, type PreviewRow } from "@/lib/tax-intel/preview";
import { readTabular, sha256Hex, type ReadResult } from "@/lib/tax-intel/read-file";
import type { RelationshipKind } from "@/lib/tax-intel/relationship";
import { useShellData } from "@/lib/tenant-shell-data";
import { cn } from "@/lib/utils";

type Search = { detalhe?: string | undefined };

export const Route = createFileRoute("/_authenticated/t/$tenantId/tributario/importacoes")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    detalhe:
      typeof s["detalhe"] === "string" && /^[0-9a-f-]{36}$/.test(s["detalhe"])
        ? s["detalhe"]
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Importações · Inteligência Tributária · TECH-IVA" },
      {
        name: "description",
        content:
          "Importação da base de clientes e fornecedores (XLSX ou CSV) para a Inteligência Tributária.",
      },
    ],
  }),
  component: ImportacoesPage,
});

/** Mesmos papéis de public.tax_can_write (migration 0241). O banco confere de novo. */
const WRITERS: MemberRole[] = [
  "platform_admin",
  "platform_ops",
  "channel_admin",
  "owner",
  "finance",
];

const STATUS: Record<ImportRow["status"], { label: string; className: string }> = {
  recebendo: { label: "Recebendo", className: "border-primary/40 bg-primary/10 text-primary" },
  finalizando: { label: "Finalizando", className: "border-primary/40 bg-primary/10 text-primary" },
  concluida: { label: "Concluída", className: "border-flow-in/40 bg-flow-in/10 text-flow-in" },
  falhou: {
    label: "Falhou",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  cancelada: { label: "Cancelada", className: "border-border bg-muted/40 text-muted-foreground" },
};

type ItemStatus =
  | "valido"
  | "ja_existente"
  | "duplicado_no_arquivo"
  | "cnpj_invalido"
  | "cnpj_ausente"
  | "relacionamento_invalido"
  | "recebido";

const ITEM_LABEL: Record<ItemStatus, string> = {
  valido: "Válido (novo)",
  ja_existente: "Já existia na carteira",
  duplicado_no_arquivo: "Repetido no arquivo",
  cnpj_invalido: "CNPJ inválido",
  cnpj_ausente: "CNPJ vazio",
  relacionamento_invalido: "Tipo não reconhecido",
  recebido: "Aguardando finalização",
};

const problemsOf = (r: ImportRow) =>
  r.invalid_cnpj_count + r.missing_cnpj_count + r.invalid_relationship_count;

function useImports(tenantId: string, live: boolean) {
  return useQuery({
    queryKey: ["tax-imports", tenantId],
    queryFn: async (): Promise<ImportRow[]> => {
      const { data, error } = await taxFrom("tax_imports")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ImportRow[];
    },
    refetchInterval: live ? 4000 : false,
  });
}

function ImportacoesPage() {
  const { tenantId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const shell = useShellData(tenantId);
  const [busy, setBusy] = useState(false);
  const imports = useImports(tenantId, busy);

  const kind = shell.data?.tenant.kind;
  const role = shell.data?.role ?? null;
  const canWrite = role !== null && WRITERS.includes(role);
  const allowedKind = kind === "company" || kind === "unit";
  const detail = imports.data?.find((i) => i.id === search.detalhe) ?? null;
  const openDetail = (id: string | null) =>
    void navigate({ search: id ? { detalhe: id } : {}, replace: true });

  if (shell.data && !allowedKind) {
    return (
      <Page>
        <PageHeader eyebrow="inteligência tributária" title="Importações" />
        <EmptyState
          icon={FileSpreadsheet}
          title="Importação só em empresa ou unidade"
          hint="A carteira de clientes e fornecedores pertence a uma empresa. Abra a empresa para importar."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="inteligência tributária"
        title="Importações"
        helpTitle="Sobre a importação"
        help={
          <>
            <p>
              Envie a base de clientes e fornecedores em XLSX ou CSV (até 100 mil linhas e 30 MB). O
              CNPJ é lido como texto, numérico ou alfanumérico, e validado de novo no banco.
            </p>
            <p className="mt-2">
              Nesta fase só a carteira é importada. Nenhuma consulta de regime é feita e nenhum
              regime é presumido.
            </p>
          </>
        }
      />
      <ModuleTabs tenantId={tenantId} />

      {canWrite ? (
        <Rise index={1}>
          <NewImport tenantId={tenantId} onBusy={setBusy} onOpenDetail={openDetail} />
        </Rise>
      ) : shell.data ? (
        <Rise index={1}>
          <p className="rounded-lg border border-border/60 bg-surface-1/60 px-4 py-3 text-xs text-muted-foreground">
            Seu papel permite consultar o histórico, mas não enviar arquivos.
          </p>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Panel
          title="Histórico"
          icon={History}
          actions={
            <Button
              size="sm"
              variant="ghost"
              aria-label="Atualizar histórico"
              onClick={() => void imports.refetch()}
              disabled={imports.isFetching}
            >
              <RefreshCw
                className={cn("size-4", imports.isFetching && "animate-spin")}
                aria-hidden
              />
            </Button>
          }
          bodyClassName="p-0"
          className="overflow-hidden"
        >
          {imports.error ? (
            <div className="p-4">
              <ErrorState
                message={(imports.error as Error).message}
                onRetry={() => void imports.refetch()}
              />
            </div>
          ) : (
            <ImportsTable
              rows={imports.data ?? []}
              loading={imports.isLoading}
              canWrite={canWrite}
              onOpen={(r) => openDetail(r.id)}
              tenantId={tenantId}
            />
          )}
        </Panel>
      </Rise>

      <ImportDetailSheet imp={detail} tenantId={tenantId} onClose={() => openDetail(null)} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Nova importação: arquivo → validação → processamento → resultado
// ---------------------------------------------------------------------------
type Loaded = { file: File; bytes: Uint8Array; sha256: string; read: ReadResult };

const STEPS = ["Arquivo", "Validação", "Processamento", "Resultado"];

const PHASES: { phase: ImportProgress["phase"]; label: string }[] = [
  { phase: "criando", label: "Registrar a importação" },
  { phase: "enviando_arquivo", label: "Guardar o arquivo original" },
  { phase: "enviando_linhas", label: "Enviar as linhas" },
  { phase: "finalizando", label: "Validar no banco e gravar a carteira" },
];

const fmtBytes = (b: number) =>
  b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

function downloadTemplate() {
  // Só o cabeçalho: nenhum dado de exemplo é inventado.
  const blob = new Blob(["﻿CNPJ;Razão social;Nome fantasia;Tipo\n"], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-carteira.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function NewImport({
  tenantId,
  onBusy,
  onOpenDetail,
}: {
  tenantId: string;
  onBusy: (v: boolean) => void;
  onOpenDetail: (id: string) => void;
}) {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [defaultRel, setDefaultRel] = useState<RelationshipKind | "nenhum">("nenhum");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [rate, setRate] = useState<{ t0: number; s0: number; perSec: number } | null>(null);

  const preview: Preview | null = useMemo(
    () =>
      loaded ? buildPreview(loaded.read.rows, defaultRel === "nenhum" ? null : defaultRel) : null,
    [loaded, defaultRel],
  );

  const reset = () => {
    setLoaded(null);
    setReadError(null);
    setProgress(null);
    setSummary(null);
    setFailure(null);
    setRate(null);
  };

  const onFile = async (file: File) => {
    reset();
    if (file.size > 30 * 1024 * 1024) {
      setReadError(`O arquivo tem ${fmtBytes(file.size)}; o limite é 30 MB.`);
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const read = await readTabular(file.name, bytes);
      setLoaded({ file, bytes, sha256: await sha256Hex(bytes), read });
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setReading(false);
    }
  };

  const onProgress = (p: ImportProgress) => {
    setProgress(p);
    setRate((r) => {
      const now = performance.now();
      if (!r || p.phase !== "enviando_linhas")
        return { t0: now, s0: p.sent, perSec: r?.perSec ?? 0 };
      const dt = (now - r.t0) / 1000;
      return dt > 0.5 ? { ...r, perSec: (p.sent - r.s0) / dt } : r;
    });
  };

  const send = useMutation({
    mutationFn: async () => {
      if (!loaded) throw new Error("Escolha um arquivo.");
      abortRef.current = new AbortController();
      setFailure(null);
      onBusy(true);
      return runImport({
        tenantId,
        file: loaded.file,
        bytes: loaded.bytes,
        sha256: loaded.sha256,
        kind: loaded.read.kind,
        sheetName: loaded.read.sheetName,
        headerLine: loaded.read.headerLine,
        rows: loaded.read.rows,
        defaultRelationship: defaultRel === "nenhum" ? null : defaultRel,
        onProgress,
        signal: abortRef.current.signal,
      });
    },
    onSuccess: (s) => {
      setSummary(s);
      toast.success("Importação concluída.");
    },
    onError: (e) => {
      const paused = (e as Error).name === "AbortError";
      setFailure(
        paused
          ? "Envio pausado. A importação ficou no histórico e pode ser retomada de onde parou."
          : (e as Error).message,
      );
      toast.error(paused ? "Envio pausado." : "A importação não terminou.");
    },
    onSettled: () => {
      onBusy(false);
      void qc.invalidateQueries({ queryKey: ["tax-imports", tenantId] });
      void qc.invalidateQueries({ queryKey: ["tax-overview", tenantId] });
      void qc.invalidateQueries({ queryKey: ["tax-portfolio", tenantId] });
    },
  });

  // Fechar a aba no meio do envio: o navegador pede confirmação.
  useEffect(() => {
    if (!send.isPending) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [send.isPending]);

  const step = summary ? 3 : send.isPending || failure ? 2 : loaded ? 1 : 0;

  return (
    <section className="panel sheen overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Upload className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">Nova importação</h2>
          <InfoHint title="Colunas aceitas">
            <p>
              CNPJ (obrigatória), razão social, nome fantasia e tipo (cliente ou fornecedor). Os
              nomes das colunas são reconhecidos com ou sem acento, em qualquer ordem.
            </p>
            <p className="mt-2">
              CNPJ com ou sem máscara, numérico ou alfanumérico. Zeros à esquerda perdidos pelo
              Excel são completados e indicados.
            </p>
          </InfoHint>
        </div>
        <Stepper steps={STEPS} current={step} className="w-full sm:w-auto sm:min-w-[440px]" />
      </header>

      <div className="p-4 sm:p-5">
        {step === 0 ? (
          <div className="space-y-3">
            <Dropzone onFile={(f) => void onFile(f)} busy={reading} disabled={reading} />
            {readError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <div>
                  <p className="font-medium text-destructive">Não foi possível ler o arquivo</p>
                  <p className="text-xs text-muted-foreground">{readError}</p>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Colunas:</span>
              {["CNPJ", "Razão social", "Nome fantasia", "Tipo"].map((c, i) => (
                <span
                  key={c}
                  className={cn(
                    "rounded-md border px-1.5 py-0.5",
                    i === 0 ? "border-primary/40 text-primary" : "border-border/70",
                  )}
                >
                  {c}
                </span>
              ))}
              <button
                type="button"
                onClick={downloadTemplate}
                className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <Download className="size-3.5" aria-hidden /> Baixar modelo
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 && loaded && preview ? (
          <Validation
            loaded={loaded}
            preview={preview}
            defaultRel={defaultRel}
            setDefaultRel={setDefaultRel}
            onReset={reset}
            onSend={() => send.mutate()}
          />
        ) : null}

        {step === 2 && progress ? (
          <Processing
            progress={progress}
            perSec={rate?.perSec ?? 0}
            pending={send.isPending}
            failure={failure}
            onPause={() => abortRef.current?.abort()}
            onRetry={() => send.mutate()}
            onReset={reset}
          />
        ) : null}

        {step === 3 && summary ? (
          <Result
            s={summary}
            tenantId={tenantId}
            onDetail={() => onOpenDetail(summary.import_id)}
            onReset={reset}
          />
        ) : null}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-mono tabular text-lg font-semibold", tone)}>{value}</p>
      {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Validation({
  loaded,
  preview,
  defaultRel,
  setDefaultRel,
  onReset,
  onSend,
}: {
  loaded: Loaded;
  preview: Preview;
  defaultRel: RelationshipKind | "nenhum";
  setDefaultRel: (v: RelationshipKind | "nenhum") => void;
  onReset: () => void;
  onSend: () => void;
}) {
  const [verdict, setVerdict] = useState<PreviewRow["verdict"] | "todos">("todos");
  const bad = preview.invalidCnpj + preview.missingCnpj + preview.invalidRelationship;
  const problems = preview.rows.filter(
    (r) => r.verdict !== "valido" && (verdict === "todos" || r.verdict === verdict),
  );
  const quality = preview.total ? preview.valid / preview.total : 0;
  const cols = loaded.read.columns;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-surface-2/30 p-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <FileSpreadsheet className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{loaded.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {loaded.read.kind.toUpperCase()} · {fmtBytes(loaded.file.size)}
            {loaded.read.sheetName ? ` · aba “${loaded.read.sheetName}”` : ""}
            {loaded.read.encoding ? ` · ${loaded.read.encoding}` : ""} · cabeçalho na linha{" "}
            {loaded.read.headerLine}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onReset}>
          Trocar arquivo
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(["cnpj", "razao", "fantasia", "rel"] as const).map((k) => {
          const label = {
            cnpj: "CNPJ",
            razao: "Razão social",
            fantasia: "Nome fantasia",
            rel: "Tipo",
          }[k];
          const found = cols[k];
          return (
            <span
              key={k}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1",
                found
                  ? "border-flow-in/40 text-foreground"
                  : "border-dashed border-border text-muted-foreground",
              )}
            >
              {found ? (
                <Check className="size-3 text-flow-in" aria-hidden />
              ) : (
                <Circle className="size-3" aria-hidden />
              )}
              {label}
              {found ? (
                <span className="text-muted-foreground">← “{found}”</span>
              ) : (
                <span>não encontrada</span>
              )}
            </span>
          );
        })}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="font-medium">Qualidade da base</span>
          <span className="font-mono tabular text-muted-foreground">
            {pct(preview.valid, preview.total)} válidas
          </span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span
            className="bg-flow-in transition-[width] duration-700"
            style={{ width: `${quality * 100}%` }}
          />
          <span
            className="bg-warn transition-[width] duration-700"
            style={{ width: `${(preview.duplicateInFile / Math.max(preview.total, 1)) * 100}%` }}
          />
          <span
            className="bg-destructive transition-[width] duration-700"
            style={{ width: `${(bad / Math.max(preview.total, 1)) * 100}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Linhas" value={n(preview.total)} />
          <Stat
            label="Válidas"
            value={n(preview.valid)}
            tone="text-flow-in"
            hint={`${n(preview.uniqueCnpjs)} CNPJs · ${n(preview.uniqueRoots)} raízes`}
          />
          <Stat
            label="Repetidas no arquivo"
            value={n(preview.duplicateInFile)}
            tone={preview.duplicateInFile ? "text-warn" : undefined}
          />
          <Stat
            label="Com problema"
            value={n(bad)}
            tone={bad ? "text-destructive" : undefined}
            hint={`${n(preview.invalidCnpj)} inválidos · ${n(preview.missingCnpj)} vazios · ${n(preview.invalidRelationship)} sem tipo`}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {n(preview.matrizes)} matrizes · {n(preview.filiais)} filiais · {n(preview.alfanumericos)}{" "}
          alfanuméricos
          {preview.padded > 0 ? ` · ${n(preview.padded)} com zeros completados` : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="default-rel" className="text-xs">
            Tipo vazio na planilha
          </Label>
          <Select value={defaultRel} onValueChange={(v) => setDefaultRel(v as typeof defaultRel)}>
            <SelectTrigger id="default-rel" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhum">Marcar como problema</SelectItem>
              <SelectItem value="cliente">Considerar cliente</SelectItem>
              <SelectItem value="fornecedor">Considerar fornecedor</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onReset}>
            Cancelar
          </Button>
          <Button className="cta-lift" disabled={preview.total === 0} onClick={onSend}>
            <Upload className="mr-2 size-4" aria-hidden /> Importar {n(preview.total)} linhas
          </Button>
        </div>
      </div>

      {preview.total - preview.valid > 0 ? (
        <div className="rounded-lg border border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <p className="text-xs font-medium">
              Inconsistências{" "}
              <span className="text-muted-foreground">(o banco valida tudo de novo)</span>
            </p>
            <Select value={verdict} onValueChange={(v) => setVerdict(v as typeof verdict)}>
              <SelectTrigger className="h-7 w-[190px] text-xs" aria-label="Filtrar inconsistências">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas</SelectItem>
                <SelectItem value="cnpj_invalido">CNPJ inválido</SelectItem>
                <SelectItem value="cnpj_ausente">CNPJ vazio</SelectItem>
                <SelectItem value="duplicado_no_arquivo">Repetido no arquivo</SelectItem>
                <SelectItem value="relacionamento_invalido">Tipo não reconhecido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-1">
                <tr className="border-b border-border">
                  <th scope="col" className="th-label px-3 py-1.5 text-left">
                    Linha
                  </th>
                  <th scope="col" className="th-label px-3 py-1.5 text-left">
                    CNPJ lido
                  </th>
                  <th scope="col" className="th-label px-3 py-1.5 text-left">
                    Nome
                  </th>
                  <th scope="col" className="th-label px-3 py-1.5 text-left">
                    Situação
                  </th>
                </tr>
              </thead>
              <tbody>
                {problems.slice(0, 200).map((r) => (
                  <tr key={r.r} className="border-b border-border/50">
                    <td className="px-3 py-1.5 font-mono tabular">{r.line}</td>
                    <td className="px-3 py-1.5 font-mono tabular">{r.cnpj ?? "—"}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5">{r.razao ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          r.verdict === "duplicado_no_arquivo" ? "text-warn" : "text-destructive"
                        }
                      >
                        {ITEM_LABEL[r.verdict]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {problems.length > 200 ? (
            <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
              Mostrando 200 de {n(problems.length)}. A lista completa fica no detalhe da importação.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Processing({
  progress,
  perSec,
  pending,
  failure,
  onPause,
  onRetry,
  onReset,
}: {
  progress: ImportProgress;
  perSec: number;
  pending: boolean;
  failure: string | null;
  onPause: () => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  const idx = PHASES.findIndex((p) => p.phase === progress.phase);
  const current = idx < 0 ? PHASES.length : idx;
  // Peso de cada fase na barra: o envio e a finalização são quase todo o tempo.
  const base = [0, 3, 6, 55][Math.min(current, 3)] ?? 100;
  const span = [3, 3, 49, 45][Math.min(current, 3)] ?? 0;
  const frac = progress.total > 0 ? progress.sent / progress.total : 0;
  const pctAll = Math.min(100, Math.round(base + span * frac));
  const remaining = progress.total - progress.sent;
  const eta =
    progress.phase === "enviando_linhas" && perSec > 0 ? Math.ceil(remaining / perSec) : null;

  return (
    <div className="space-y-5" aria-live="polite">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-sm font-medium">
            {failure ? "Envio interrompido" : PHASES[Math.min(current, 3)]?.label}
          </p>
          <span className="font-mono tabular text-sm">{pctAll}%</span>
        </div>
        <Progress
          value={pctAll}
          className={cn(failure && "opacity-60")}
          aria-label="Progresso da importação"
        />
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular">
            {n(progress.sent)} / {n(progress.total)} linhas
          </span>
          {perSec > 0 && pending ? (
            <span className="font-mono tabular">
              {n(Math.round(perSec))} linhas/s
              {eta !== null
                ? ` · ~${eta < 60 ? `${eta}s` : `${Math.ceil(eta / 60)} min`} restantes`
                : ""}
            </span>
          ) : null}
        </div>
      </div>

      <ol className="space-y-2">
        {PHASES.map((p, i) => {
          const done = i < current;
          const active = i === current && !failure;
          const failed = i === current && failure;
          return (
            <li
              key={p.phase}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-300",
                active ? "border-primary/40 bg-primary/5" : "border-border/60",
                failed && "border-destructive/40 bg-destructive/5",
              )}
            >
              <span className="grid size-6 place-items-center">
                {done ? (
                  <CheckCircle2 className="size-5 text-flow-in" aria-hidden />
                ) : active ? (
                  <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
                ) : failed ? (
                  <XCircle className="size-5 text-destructive" aria-hidden />
                ) : (
                  <Circle className="size-4 text-muted-foreground/50" aria-hidden />
                )}
              </span>
              <span className={cn(!done && !active && !failed && "text-muted-foreground")}>
                {p.label}
              </span>
              {active && (p.phase === "enviando_linhas" || p.phase === "finalizando") ? (
                <span className="ml-auto font-mono tabular text-xs text-muted-foreground">
                  {pct(progress.sent, progress.total)}
                </span>
              ) : done ? (
                <span className="ml-auto text-xs text-flow-in">feito</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {failure ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5"
        >
          <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
          <p className="min-w-0 flex-1 text-xs">{failure}</p>
          <Button size="sm" variant="outline" onClick={onReset}>
            Fechar
          </Button>
          <Button size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden /> Tentar de novo
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Se a conexão cair, retome pelo histórico de onde parou.
          </p>
          <Button variant="outline" size="sm" onClick={onPause} disabled={!pending}>
            <Pause className="mr-1.5 size-3.5" aria-hidden /> Pausar envio
          </Button>
        </div>
      )}
    </div>
  );
}

function Result({
  s,
  tenantId,
  onDetail,
  onReset,
}: {
  s: ImportSummary;
  tenantId: string;
  onDetail: () => void;
  onReset: () => void;
}) {
  const bad = s.invalid_cnpj + s.missing_cnpj + s.invalid_relationship;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid size-11 animate-in zoom-in-50 place-items-center rounded-full bg-flow-in/15 text-flow-in duration-500">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-base font-semibold">Importação concluída</p>
          <p className="text-xs text-muted-foreground">
            {n(s.unique_cnpjs)} CNPJs em {n(s.unique_roots)} raízes · {n(s.new_relationships)}{" "}
            relacionamentos novos
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Novos na carteira" value={n(s.valid)} tone="text-flow-in" />
        <Stat label="Já existiam" value={n(s.already_existing)} />
        <Stat
          label="Repetidos no arquivo"
          value={n(s.duplicate_in_file)}
          tone={s.duplicate_in_file ? "text-warn" : undefined}
        />
        <Stat label="Com problema" value={n(bad)} tone={bad ? "text-destructive" : undefined} />
      </div>
      <p className="text-xs text-muted-foreground">
        O regime tributário ainda não foi consultado: os CNPJs entram como “Consulta pendente”.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onReset}>
          Nova importação
        </Button>
        <Button variant="outline" onClick={onDetail}>
          Ver linhas
        </Button>
        <Button asChild className="cta-lift">
          <Link
            to="/t/$tenantId/tributario/carteira"
            params={{ tenantId }}
            search={{ importacao: s.import_id }}
          >
            <Table2 className="mr-2 size-4" aria-hidden /> Ver na carteira
            <ArrowRight className="ml-1 size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: ImportRow["status"] }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        s.className,
      )}
    >
      {status === "recebendo" || status === "finalizando" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      ) : null}
      {s.label}
    </span>
  );
}

function ImportsTable({
  rows,
  loading,
  canWrite,
  onOpen,
  tenantId,
}: {
  rows: ImportRow[];
  loading: boolean;
  canWrite: boolean;
  onOpen: (row: ImportRow) => void;
  tenantId: string;
}) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<Record<string, ImportProgress>>({});
  const [confirmCancel, setConfirmCancel] = useState<ImportRow | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["tax-imports", tenantId] });
    void qc.invalidateQueries({ queryKey: ["tax-overview", tenantId] });
  };
  const resume = useMutation({
    mutationFn: (row: ImportRow) =>
      resumeImport(row, (p) => setProgress((s) => ({ ...s, [row.id]: p }))),
    onSuccess: () => toast.success("Importação concluída."),
    onError: (e) => toast.error((e as Error).message),
    onSettled: invalidate,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelImport(id),
    onSuccess: () => toast.success("Importação cancelada. As linhas recebidas ficam registradas."),
    onError: (e) => toast.error((e as Error).message),
    onSettled: invalidate,
  });

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={History}
          title="Nenhuma importação ainda"
          hint={canWrite ? "Arraste a planilha na área acima para começar." : undefined}
        />
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="th-label px-4 py-2 text-left">
                Arquivo
              </th>
              <th scope="col" className="th-label px-3 py-2 text-left">
                Situação
              </th>
              <th scope="col" className="th-label px-3 py-2 text-right">
                Linhas
              </th>
              <th scope="col" className="th-label px-3 py-2 text-right">
                Novos
              </th>
              <th scope="col" className="th-label px-3 py-2 text-right">
                Já existiam
              </th>
              <th scope="col" className="th-label px-3 py-2 text-right">
                Recusadas
              </th>
              <th scope="col" className="th-label px-4 py-2 text-right">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = progress[r.id];
              const open = r.status === "recebendo" || r.status === "finalizando";
              const refused = problemsOf(r) + r.duplicate_count;
              return (
                <tr
                  key={r.id}
                  className="row-hover cursor-pointer border-b border-border/50"
                  onClick={() => onOpen(r)}
                >
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      className="focus-glow block max-w-[280px] truncate rounded text-left font-medium hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(r);
                      }}
                    >
                      {r.file_name}
                    </button>
                    <span
                      className="font-mono tabular text-[11px] text-muted-foreground"
                      title={dateTime(r.created_at)}
                    >
                      {r.file_kind.toUpperCase()} · {since(r.created_at)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={r.status} />
                    {p && p.phase !== "concluida" ? (
                      <Progress
                        value={p.total ? (p.sent / p.total) * 100 : 0}
                        className="mt-1.5 h-1 w-24"
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-xs">
                    {open ? `${n(r.received_rows)} / ${n(r.expected_rows)}` : n(r.expected_rows)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-flow-in">
                    {n(r.valid_count)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">
                    {n(r.existing_count)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right font-mono tabular",
                      refused > 0 && "text-warn",
                    )}
                  >
                    {n(refused)}
                  </td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {canWrite && open ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resume.isPending}
                          onClick={() => resume.mutate(r)}
                        >
                          {resume.isPending && resume.variables?.id === r.id ? (
                            <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Play className="mr-1 size-3.5" aria-hidden />
                          )}
                          Retomar
                        </Button>
                        {r.status === "recebendo" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={cancel.isPending}
                            onClick={() => setConfirmCancel(r)}
                          >
                            <XCircle className="mr-1 size-3.5" aria-hidden /> Cancelar
                          </Button>
                        ) : null}
                      </div>
                    ) : r.status === "concluida" ? (
                      <div className="flex justify-end">
                        <Button asChild size="sm" variant="ghost">
                          <Link
                            to="/t/$tenantId/tributario/carteira"
                            params={{ tenantId }}
                            search={{ importacao: r.id }}
                          >
                            Carteira <ArrowRight className="ml-1 size-3.5" aria-hidden />
                          </Link>
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AlertDialog open={Boolean(confirmCancel)} onOpenChange={(v) => !v && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta importação?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCancel?.file_name}: as linhas já recebidas ficam registradas, mas nada entra
              na carteira. Para importar de novo, envie o arquivo outra vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmCancel) cancel.mutate(confirmCancel.id);
                setConfirmCancel(null);
              }}
            >
              Cancelar importação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detalhe: linhas por situação, paginadas no servidor
// ---------------------------------------------------------------------------
type ItemRow = {
  row_number: number;
  cnpj_raw: string | null;
  cnpj: string | null;
  razao_social: string | null;
  status: ItemStatus;
  error: string | null;
  normalization_note: string | null;
};

const PAGE = 50;

function ImportDetailSheet({
  imp,
  tenantId,
  onClose,
}: {
  imp: ImportRow | null;
  tenantId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ItemStatus | "todos">("todos");
  const [page, setPage] = useState(0);

  useEffect(() => {
    setStatus("todos");
    setPage(0);
  }, [imp?.id]);

  const items = useQuery({
    enabled: Boolean(imp),
    queryKey: ["tax-import-items", imp?.id, status, page],
    queryFn: async () => {
      let q = taxFrom("tax_import_items")
        .select("row_number, cnpj_raw, cnpj, razao_social, status, error, normalization_note", {
          count: "exact",
        })
        .eq("import_id", imp!.id)
        .order("row_number")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (status !== "todos") q = q.eq("status", status);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as ItemRow[], total: (count ?? 0) as number };
    },
  });

  return (
    <SideSheet
      open={Boolean(imp)}
      onOpenChange={(v) => !v && onClose()}
      title={imp?.file_name ?? ""}
      description={
        imp
          ? `${STATUS[imp.status].label} · ${n(imp.received_rows)} de ${n(imp.expected_rows)} linhas recebidas · ${dateTime(imp.created_at)}`
          : undefined
      }
      footer={
        imp?.status === "concluida" ? (
          <Button asChild className="w-full">
            <Link
              to="/t/$tenantId/tributario/carteira"
              params={{ tenantId }}
              search={{ importacao: imp.id }}
            >
              <Table2 className="mr-2 size-4" aria-hidden /> Ver estes CNPJs na carteira
            </Link>
          </Button>
        ) : undefined
      }
    >
      {imp ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Novos" value={n(imp.valid_count)} tone="text-flow-in" />
            <Stat label="Já existiam" value={n(imp.existing_count)} />
            <Stat
              label="Repetidos"
              value={n(imp.duplicate_count)}
              tone={imp.duplicate_count ? "text-warn" : undefined}
            />
            <Stat
              label="Com problema"
              value={n(problemsOf(imp))}
              tone={problemsOf(imp) ? "text-destructive" : undefined}
              hint={`${n(imp.invalid_cnpj_count)} inválidos · ${n(imp.missing_cnpj_count)} vazios · ${n(imp.invalid_relationship_count)} sem tipo`}
            />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border/60 px-3 py-2">
              <dt className="text-muted-foreground">CNPJs únicos</dt>
              <dd className="font-mono tabular">
                {n(imp.unique_cnpjs)} em {n(imp.unique_roots)} raízes
              </dd>
            </div>
            <div className="rounded-lg border border-border/60 px-3 py-2">
              <dt className="text-muted-foreground">SHA-256 do original</dt>
              <dd className="truncate font-mono" title={imp.file_sha256}>
                {imp.file_sha256.slice(0, 16)}…
              </dd>
            </div>
          </dl>
          <div className="space-y-1.5">
            <Label className="text-xs">Situação da linha</Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as typeof status);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas</SelectItem>
                {(Object.keys(ITEM_LABEL) as ItemStatus[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ITEM_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {items.error ? (
            <ErrorState
              message={(items.error as Error).message}
              onRetry={() => void items.refetch()}
            />
          ) : (
            <div className="rounded-lg border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="th-label px-3 py-1.5 text-left">
                      Linha
                    </th>
                    <th scope="col" className="th-label px-3 py-1.5 text-left">
                      CNPJ
                    </th>
                    <th scope="col" className="th-label px-3 py-1.5 text-left">
                      Situação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.isLoading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>
                          <td colSpan={3} className="px-3 py-1.5">
                            <Skeleton className="h-4" />
                          </td>
                        </tr>
                      ))
                    : (items.data?.rows ?? []).map((r) => (
                        <tr key={r.row_number} className="border-b border-border/50 align-top">
                          <td className="px-3 py-1.5 font-mono tabular">
                            {imp.first_data_line + r.row_number - 1}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="font-mono tabular">
                              {r.cnpj ? formatCnpj(r.cnpj) : (r.cnpj_raw ?? "—")}
                            </span>
                            {r.razao_social ? (
                              <span className="block max-w-[180px] truncate text-muted-foreground">
                                {r.razao_social}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className={cn(
                                r.status === "valido" && "text-flow-in",
                                r.status === "duplicado_no_arquivo" && "text-warn",
                                [
                                  "cnpj_invalido",
                                  "cnpj_ausente",
                                  "relacionamento_invalido",
                                ].includes(r.status) && "text-destructive",
                              )}
                            >
                              {ITEM_LABEL[r.status]}
                            </span>
                            {r.error ? (
                              <span className="block text-muted-foreground">{r.error}</span>
                            ) : null}
                            {r.normalization_note ? (
                              <span className="block text-muted-foreground">
                                {r.normalization_note}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {!items.isLoading && (items.data?.rows.length ?? 0) === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Nenhuma linha nesta situação.
                </p>
              ) : null}
              <Pager
                page={page}
                pageSize={PAGE}
                total={items.data?.total ?? 0}
                onPageChange={setPage}
                unit="linha(s)"
                loading={items.isFetching}
              />
            </div>
          )}
        </div>
      ) : null}
    </SideSheet>
  );
}
