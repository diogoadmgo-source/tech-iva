import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSpreadsheet, History, Play, Upload, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/techiva/data-table";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { Kpi } from "@/components/techiva/kpi";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Badge } from "@/components/ui/badge";
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
import { buildPreview, type Preview, type PreviewRow } from "@/lib/tax-intel/preview";
import { readTabular, sha256Hex, type ReadResult } from "@/lib/tax-intel/read-file";
import type { RelationshipKind } from "@/lib/tax-intel/relationship";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/tributario/importacoes")({
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

const STATUS_LABEL: Record<ImportRow["status"], string> = {
  recebendo: "Recebendo",
  finalizando: "Finalizando",
  concluida: "Concluída",
  falhou: "Falhou",
  cancelada: "Cancelada",
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

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR");

function useImports(tenantId: string) {
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
  });
}

function ImportacoesPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const imports = useImports(tenantId);
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<ImportRow | null>(null);

  const kind = shell.data?.tenant.kind;
  const role = shell.data?.role ?? null;
  const canWrite = role !== null && WRITERS.includes(role);
  const allowedKind = kind === "company" || kind === "unit";

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
        actions={
          canWrite ? (
            <Button className="cta-lift" onClick={() => setNewOpen(true)}>
              <Upload className="mr-2 size-4" /> Nova importação
            </Button>
          ) : null
        }
      />

      <Rise index={1}>
        <Panel title="Histórico" icon={History}>
          {imports.error ? (
            <ErrorState
              message={(imports.error as Error).message}
              onRetry={() => void imports.refetch()}
            />
          ) : (
            <ImportsTable
              rows={imports.data ?? []}
              loading={imports.isLoading}
              canWrite={canWrite}
              onOpen={setDetail}
              tenantId={tenantId}
            />
          )}
        </Panel>
      </Rise>

      {canWrite ? (
        <NewImportSheet open={newOpen} onOpenChange={setNewOpen} tenantId={tenantId} />
      ) : null}
      <ImportDetailSheet imp={detail} onClose={() => setDetail(null)} />
    </Page>
  );
}

function StatusBadge({ status }: { status: ImportRow["status"] }) {
  const variant =
    status === "concluida"
      ? "secondary"
      : status === "cancelada" || status === "falhou"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant} className="rounded-full px-2 py-0.5 text-[11px] font-medium">
      {STATUS_LABEL[status]}
    </Badge>
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

  const resume = useMutation({
    mutationFn: (row: ImportRow) =>
      resumeImport(row, (p) => setProgress((s) => ({ ...s, [row.id]: p }))),
    onSuccess: () => toast.success("Importação concluída."),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tax-imports", tenantId] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelImport(id),
    onSuccess: () => toast.success("Importação cancelada. As linhas recebidas ficam registradas."),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tax-imports", tenantId] }),
  });

  const columns = useMemo<ColumnDef<ImportRow, unknown>[]>(
    () => [
      {
        accessorKey: "file_name",
        header: "Arquivo",
        cell: ({ row }) => (
          <button
            type="button"
            className="text-left font-medium hover:underline"
            onClick={() => onOpen(row.original)}
          >
            {row.original.file_name}
          </button>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Enviado em",
        cell: ({ row }) => (
          <span className="font-mono tabular text-xs">
            {new Date(row.original.created_at).toLocaleString("pt-BR")}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Situação",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "expected_rows",
        header: "Linhas",
        cell: ({ row }) => {
          const p = progress[row.original.id];
          if (p && p.phase !== "concluida") {
            return (
              <span className="font-mono tabular text-xs">
                {n(p.sent)} / {n(p.total)}
              </span>
            );
          }
          return <span className="font-mono tabular text-xs">{n(row.original.expected_rows)}</span>;
        },
      },
      {
        accessorKey: "valid_count",
        header: "Novos",
        cell: ({ row }) => <span className="font-mono tabular">{n(row.original.valid_count)}</span>,
      },
      {
        accessorKey: "existing_count",
        header: "Já existiam",
        cell: ({ row }) => (
          <span className="font-mono tabular">{n(row.original.existing_count)}</span>
        ),
      },
      {
        accessorKey: "invalid_cnpj_count",
        header: "Com problema",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="font-mono tabular">
              {n(
                r.invalid_cnpj_count +
                  r.missing_cnpj_count +
                  r.invalid_relationship_count +
                  r.duplicate_count,
              )}
            </span>
          );
        },
      },
      {
        id: "acoes",
        header: "",
        cell: ({ row }) => {
          const r = row.original;
          const open = r.status === "recebendo" || r.status === "finalizando";
          if (!canWrite || !open) return null;
          return (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={resume.isPending}
                onClick={() => resume.mutate(r)}
              >
                <Play className="mr-1 size-3.5" /> Retomar
              </Button>
              {r.status === "recebendo" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(r.id)}
                >
                  <XCircle className="mr-1 size-3.5" /> Cancelar
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canWrite, cancel, onOpen, progress, resume],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      emptyTitle="Nenhuma importação ainda"
      emptyHint={
        canWrite
          ? "Use “Nova importação” para enviar a base de clientes e fornecedores."
          : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Nova importação: arquivo → prévia → envio
// ---------------------------------------------------------------------------
type Loaded = { file: File; bytes: Uint8Array; sha256: string; read: ReadResult };

function NewImportSheet({
  open,
  onOpenChange,
  tenantId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [defaultRel, setDefaultRel] = useState<RelationshipKind | "nenhum">("nenhum");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

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
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
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

  const send = useMutation({
    mutationFn: async () => {
      if (!loaded) throw new Error("Escolha um arquivo.");
      abortRef.current = new AbortController();
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
        onProgress: setProgress,
        signal: abortRef.current.signal,
      });
    },
    onSuccess: (s) => {
      setSummary(s);
      toast.success("Importação concluída.");
    },
    onError: (e) =>
      toast.error(
        (e as Error).name === "AbortError"
          ? "Envio pausado. Retome pelo histórico quando quiser."
          : (e as Error).message,
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tax-imports", tenantId] }),
  });

  const pct =
    progress && progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
  const problems = (preview?.rows ?? []).filter((r) => r.verdict !== "valido").slice(0, 50);

  return (
    <SideSheet
      open={open}
      onOpenChange={(v) => {
        if (!v && send.isPending) return; // não fecha no meio do envio
        if (!v) reset();
        onOpenChange(v);
      }}
      title="Nova importação"
      description="XLSX ou CSV, até 100 mil linhas e 30 MB. Colunas: CNPJ (obrigatória), razão social, nome fantasia, tipo."
      footer={
        summary ? (
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        ) : send.isPending ? (
          <Button variant="outline" className="w-full" onClick={() => abortRef.current?.abort()}>
            Pausar envio
          </Button>
        ) : (
          <Button
            className="w-full cta-lift"
            disabled={!preview || preview.total === 0}
            onClick={() => send.mutate()}
          >
            <Upload className="mr-2 size-4" /> Importar {preview ? n(preview.total) : ""} linhas
          </Button>
        )
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="tax-file">Arquivo</Label>
          <input
            id="tax-file"
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,.txt"
            disabled={send.isPending}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {reading ? <p className="text-xs text-muted-foreground">Lendo o arquivo…</p> : null}
          {readError ? <p className="text-xs text-destructive">{readError}</p> : null}
          {loaded ? (
            <p className="text-xs text-muted-foreground">
              {loaded.read.kind.toUpperCase()}
              {loaded.read.sheetName ? ` · aba “${loaded.read.sheetName}”` : ""}
              {loaded.read.encoding ? ` · ${loaded.read.encoding}` : ""} · cabeçalho na linha{" "}
              {loaded.read.headerLine} · colunas: {Object.values(loaded.read.columns).join(", ")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Quando o tipo estiver vazio, considerar</Label>
          <Select
            value={defaultRel}
            onValueChange={(v) => setDefaultRel(v as typeof defaultRel)}
            disabled={send.isPending}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhum">Não considerar (linha fica com problema)</SelectItem>
              <SelectItem value="cliente">Cliente</SelectItem>
              <SelectItem value="fornecedor">Fornecedor</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {preview && !summary ? <PreviewBlock preview={preview} problems={problems} /> : null}

        {progress && !summary ? (
          <div className="space-y-2">
            <p className="text-sm">
              {progress.phase === "enviando_linhas"
                ? `Enviando linhas: ${n(progress.sent)} de ${n(progress.total)}`
                : progress.phase === "finalizando"
                  ? `Finalizando: ${n(progress.sent)} de ${n(progress.total)}`
                  : progress.phase === "enviando_arquivo"
                    ? "Guardando o arquivo original…"
                    : "Registrando a importação…"}
            </p>
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">
              Se a conexão cair, a importação fica no histórico e pode ser retomada de onde parou.
            </p>
          </div>
        ) : null}

        {summary ? <SummaryBlock s={summary} /> : null}
      </div>
    </SideSheet>
  );
}

function PreviewBlock({ preview, problems }: { preview: Preview; problems: PreviewRow[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Prévia (o banco valida tudo de novo)</p>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Linhas" value={n(preview.total)} interactive={false} />
        <Kpi label="Válidas" value={n(preview.valid)} interactive={false} />
        <Kpi label="Repetidas no arquivo" value={n(preview.duplicateInFile)} interactive={false} />
        <Kpi
          label="Com problema"
          value={n(preview.invalidCnpj + preview.missingCnpj + preview.invalidRelationship)}
          hint={`${n(preview.invalidCnpj)} inválidos · ${n(preview.missingCnpj)} vazios · ${n(preview.invalidRelationship)} sem tipo`}
          interactive={false}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {n(preview.uniqueCnpjs)} CNPJs únicos em {n(preview.uniqueRoots)} raízes ·{" "}
        {n(preview.matrizes)} matrizes · {n(preview.filiais)} filiais · {n(preview.alfanumericos)}{" "}
        alfanuméricos
        {preview.padded > 0 ? ` · ${n(preview.padded)} com zeros à esquerda completados` : ""}
      </p>
      {problems.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="th-label">
                  Linha
                </th>
                <th scope="col" className="th-label">
                  CNPJ
                </th>
                <th scope="col" className="th-label">
                  Situação
                </th>
              </tr>
            </thead>
            <tbody>
              {problems.map((r) => (
                <tr key={r.r} className="border-b border-border/60">
                  <td className="px-3 py-1.5 font-mono tabular">{r.line}</td>
                  <td className="px-3 py-1.5 font-mono tabular">{r.cnpj ?? "—"}</td>
                  <td className="px-3 py-1.5">{ITEM_LABEL[r.verdict]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function SummaryBlock({ s }: { s: ImportSummary }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Resultado gravado</p>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Novos na carteira" value={n(s.valid)} interactive={false} />
        <Kpi label="Já existiam" value={n(s.already_existing)} interactive={false} />
        <Kpi label="Repetidos no arquivo" value={n(s.duplicate_in_file)} interactive={false} />
        <Kpi
          label="Com problema"
          value={n(s.invalid_cnpj + s.missing_cnpj + s.invalid_relationship)}
          interactive={false}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {n(s.unique_cnpjs)} CNPJs únicos em {n(s.unique_roots)} raízes · {n(s.new_relationships)}{" "}
        relacionamentos novos. O regime tributário ainda não foi consultado.
      </p>
    </div>
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

function ImportDetailSheet({ imp, onClose }: { imp: ImportRow | null; onClose: () => void }) {
  const [status, setStatus] = useState<ItemStatus | "todos">("todos");
  const [page, setPage] = useState(0);

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

  const columns = useMemo<ColumnDef<ItemRow, unknown>[]>(
    () => [
      {
        accessorKey: "row_number",
        header: "Linha",
        cell: ({ row }) => (
          <span className="font-mono tabular text-xs">
            {imp ? imp.first_data_line + row.original.row_number - 1 : row.original.row_number}
          </span>
        ),
      },
      {
        accessorKey: "cnpj",
        header: "CNPJ",
        cell: ({ row }) => (
          <span className="font-mono tabular text-xs">
            {row.original.cnpj ? formatCnpj(row.original.cnpj) : (row.original.cnpj_raw ?? "—")}
          </span>
        ),
      },
      { accessorKey: "razao_social", header: "Razão social" },
      {
        accessorKey: "status",
        header: "Situação",
        cell: ({ row }) => (
          <span className="text-xs">
            {ITEM_LABEL[row.original.status]}
            {row.original.error ? ` · ${row.original.error}` : ""}
            {row.original.normalization_note ? ` · ${row.original.normalization_note}` : ""}
          </span>
        ),
      },
    ],
    [imp],
  );

  return (
    <SideSheet
      open={Boolean(imp)}
      onOpenChange={(v) => {
        if (!v) {
          setStatus("todos");
          setPage(0);
          onClose();
        }
      }}
      title={imp?.file_name ?? ""}
      description={
        imp
          ? `${STATUS_LABEL[imp.status]} · ${n(imp.received_rows)} de ${n(imp.expected_rows)} linhas recebidas`
          : undefined
      }
    >
      {imp ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Novos" value={n(imp.valid_count)} interactive={false} />
            <Kpi label="Já existiam" value={n(imp.existing_count)} interactive={false} />
            <Kpi label="Repetidos" value={n(imp.duplicate_count)} interactive={false} />
            <Kpi
              label="Com problema"
              value={n(
                imp.invalid_cnpj_count + imp.missing_cnpj_count + imp.invalid_relationship_count,
              )}
              interactive={false}
            />
          </div>
          <div className="space-y-2">
            <Label>Situação da linha</Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as typeof status);
                setPage(0);
              }}
            >
              <SelectTrigger>
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
            <DataTable
              columns={columns}
              data={items.data?.rows ?? []}
              loading={items.isLoading}
              density="compact"
              exportName={`importacao-${imp.id.slice(0, 8)}`}
              emptyTitle="Nenhuma linha nesta situação"
              serverPagination={{
                page,
                pageSize: PAGE,
                total: items.data?.total ?? 0,
                unit: "linha(s)",
                onPageChange: setPage,
              }}
            />
          )}
        </div>
      ) : null}
    </SideSheet>
  );
}
