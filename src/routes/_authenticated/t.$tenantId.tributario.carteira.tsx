import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  Search,
  Table2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ClassificationBadge } from "@/components/tax-intel/classification-badge";
import { ModuleTabs } from "@/components/tax-intel/module-tabs";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { Page, PageHeader, Rise, Segmented } from "@/components/techiva/page";
import { Pager } from "@/components/techiva/pager";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cnpjParts, formatCnpj } from "@/lib/tax-intel/cnpj";
import { loadConsultas } from "@/lib/tax-intel/consulta-optantes";
import { buildWorkbook, downloadBlob } from "@/lib/tax-intel/excel";
import {
  basisLines,
  CLASSIFICATION_LABEL,
  CLASSIFICATIONS,
  CONSULTATION_LABEL,
  dateTime,
  n,
  RELATIONSHIP_LABEL,
  sourceName,
  type TaxClassification,
} from "@/lib/tax-intel/labels";
import {
  EMPTY_FILTERS,
  loadEntityDetail,
  loadPortfolioAll,
  loadPortfolioPage,
  type PortfolioFilters,
  type PortfolioRow,
  type Sort,
  type SortKey,
} from "@/lib/tax-intel/portfolio";
import type { RelationshipKind } from "@/lib/tax-intel/relationship";
import { isActive, loadProcessingStatus, phaseOf, type Phase } from "@/lib/tax-intel/processing";
import { useShellData } from "@/lib/tenant-shell-data";
import { cn } from "@/lib/utils";

type Search = {
  q?: string | undefined;
  tipo?: RelationshipKind | undefined;
  classe?: TaxClassification | undefined;
  estrutura?: "matriz" | "filial" | undefined;
  alfa?: boolean | undefined;
  importacao?: string | undefined;
  /** Vindo do passo "Baixar o resultado": gera o Excel assim que a tela abre. */
  exportar?: boolean | undefined;
};

const UUID = /^[0-9a-f-]{36}$/;

export const Route = createFileRoute("/_authenticated/t/$tenantId/tributario/carteira")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"].slice(0, 120) : undefined,
    tipo: s["tipo"] === "cliente" || s["tipo"] === "fornecedor" ? s["tipo"] : undefined,
    classe: CLASSIFICATIONS.includes(s["classe"] as TaxClassification)
      ? (s["classe"] as TaxClassification)
      : undefined,
    estrutura:
      s["estrutura"] === "matriz" || s["estrutura"] === "filial" ? s["estrutura"] : undefined,
    alfa: s["alfa"] === true || s["alfa"] === "true" ? true : undefined,
    importacao:
      typeof s["importacao"] === "string" && UUID.test(s["importacao"])
        ? s["importacao"]
        : undefined,
    exportar: s["exportar"] === true || s["exportar"] === "true" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Base de CNPJs · Inteligência Tributária · TECH-IVA" },
      { name: "description", content: "Clientes e fornecedores com classificação tributária." },
    ],
  }),
  component: CarteiraPage,
});

const key = (r: PortfolioRow) => `${r.cnpj}|${r.relationship}`;

function toFilters(s: Search): PortfolioFilters {
  return {
    ...EMPTY_FILTERS,
    q: s.q ?? "",
    rel: s.tipo ?? "todos",
    classe: s.classe ?? "todas",
    estrutura: s.estrutura ?? "todas",
    alfanumerico: s.alfa ?? false,
    importId: s.importacao ?? null,
  };
}

function describe(f: PortfolioFilters): string {
  const parts: string[] = [];
  if (f.q) parts.push(`busca “${f.q}”`);
  if (f.rel !== "todos") parts.push(RELATIONSHIP_LABEL[f.rel]);
  if (f.estrutura !== "todas") parts.push(f.estrutura === "matriz" ? "Matrizes" : "Filiais");
  if (f.classe !== "todas") parts.push(CLASSIFICATION_LABEL[f.classe]);
  if (f.alfanumerico) parts.push("Alfanuméricos");
  if (f.importId) parts.push(`importação ${f.importId.slice(0, 8)}`);
  return parts.length ? parts.join(" · ") : "Toda a base";
}

function CarteiraPage() {
  const { tenantId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const shell = useShellData(tenantId);
  const kind = shell.data?.tenant.kind;
  const allowedKind = kind === "company" || kind === "unit";

  const filters = useMemo(() => toFilters(search), [search]);
  const [sort, setSort] = useState<Sort>({ key: "created_at", desc: true });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Map<string, PortfolioRow>>(new Map());
  const [detail, setDetail] = useState<PortfolioRow | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [qInput, setQInput] = useState(search.q ?? "");
  const searchRef = useRef<HTMLInputElement>(null);

  const setSearch = (patch: Partial<Search>) => {
    setPage(0);
    void navigate({ search: (prev: Search) => ({ ...prev, ...patch }), replace: true });
  };

  // Busca com espera de 300 ms: não dispara uma consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== qInput.trim()) setSearch({ q: qInput.trim() || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // "/" foca a busca, como nas ferramentas de mercado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        e.key === "/" &&
        el &&
        !["INPUT", "TEXTAREA"].includes(el.tagName) &&
        !el.isContentEditable
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Andamento do motor: enquanto o processamento roda, a base se atualiza
  // sozinha e as linhas já gravadas aparecem com a nova classe.
  const proc = useQuery({
    enabled: allowedKind,
    queryKey: ["tax-processing", tenantId],
    queryFn: () => loadProcessingStatus(tenantId),
    refetchInterval: (query) =>
      query.state.data && isActive(phaseOf(query.state.data)) ? 5_000 : 60_000,
  });
  const phase = proc.data ? phaseOf(proc.data) : null;
  const running = phase ? isActive(phase) : false;

  const q = useQuery({
    enabled: allowedKind,
    queryKey: ["tax-portfolio", tenantId, filters, sort, page, pageSize],
    queryFn: () => loadPortfolioPage(tenantId, filters, sort, page, pageSize),
    placeholderData: keepPreviousData,
    refetchInterval: running ? 15_000 : false,
  });

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pageKeys = rows.map(key);
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  const someOnPage = pageKeys.some((k) => selected.has(k));
  const activeFilters =
    filters.q ||
    filters.rel !== "todos" ||
    filters.estrutura !== "todas" ||
    filters.classe !== "todas" ||
    filters.alfanumerico ||
    filters.importId;

  const toggleSort = (k: SortKey) => {
    setPage(0);
    setSort((s) => (s.key === k ? { key: k, desc: !s.desc } : { key: k, desc: false }));
  };

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (allOnPage) pageKeys.forEach((k) => next.delete(k));
      else rows.forEach((r) => next.set(key(r), r));
      return next;
    });

  const toggleRow = (r: PortfolioRow) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key(r))) next.delete(key(r));
      else next.set(key(r), r);
      return next;
    });

  async function exportRows(source: "filtro" | "selecao") {
    try {
      setExporting(0);
      const data =
        source === "selecao"
          ? [...selected.values()]
          : await loadPortfolioAll(tenantId, filters, sort, (l) => setExporting(l));
      const consultas = await loadConsultas(tenantId);
      const blob = await buildWorkbook(data, {
        filtro: source === "selecao" ? `${n(data.length)} selecionados` : describe(filters),
        empresa: shell.data?.tenant.name ?? null,
        consultas,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `base-de-cnpjs-${stamp}.xlsx`);
      toast.success(`Excel gerado com ${n(data.length)} linhas.`);
    } catch (e) {
      toast.error(`Não foi possível exportar: ${(e as Error).message}`, {
        action: { label: "Tentar de novo", onClick: () => void exportRows(source) },
      });
    } finally {
      setExporting(null);
    }
  }

  // Atalho do passo "Baixar o resultado": exporta toda a base uma vez.
  const autoExported = useRef(false);
  useEffect(() => {
    if (!search.exportar || autoExported.current || !q.data) return;
    autoExported.current = true;
    void navigate({ search: (prev: Search) => ({ ...prev, exportar: undefined }), replace: true });
    void exportRows("filtro");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.exportar, q.data]);

  async function copySelected() {
    const text = [...new Set([...selected.values()].map((r) => r.cnpj))].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${n(text.split("\n").length)} CNPJs copiados.`);
    } catch {
      toast.error("O navegador bloqueou a cópia.");
    }
  }

  if (shell.data && !allowedKind) {
    return (
      <Page>
        <PageHeader eyebrow="inteligência tributária" title="Base de CNPJs" />
        <EmptyState
          icon={Building2}
          title="Disponível em empresa ou unidade"
          hint="A base de CNPJs de clientes e fornecedores pertence a uma empresa. Abra a empresa."
        />
      </Page>
    );
  }

  return (
    <Page className="max-w-7xl">
      <PageHeader
        eyebrow="inteligência tributária"
        title="Base de CNPJs"
        helpTitle="Sobre a base de CNPJs"
        help={
          <>
            <p>
              Uma linha por relacionamento: o mesmo CNPJ aparece duas vezes se for cliente e
              fornecedor. Busca por CNPJ (com ou sem máscara, inclusive parcial) ou pelo nome
              declarado na importação.
            </p>
            <p className="mt-2">
              A exportação Excel leva todas as linhas do filtro atual, não só a página.
            </p>
          </>
        }
        meta={
          q.data ? (
            <span>
              <span className="font-mono tabular text-foreground">{n(total)}</span> relacionamentos
              {activeFilters ? " no filtro" : ""}
            </span>
          ) : null
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={exporting !== null || total === 0}
            onClick={() => void exportRows("filtro")}
          >
            {exporting !== null && selected.size === 0 ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-2 size-4" aria-hidden />
            )}
            {exporting !== null ? `Exportando ${n(exporting)}…` : "Exportar Excel"}
          </Button>
        }
      />
      <ModuleTabs tenantId={tenantId} />

      {phase ? <RunBanner phase={phase} tenantId={tenantId} /> : null}

      <Rise index={1} className="panel sheen">
        {/* Barra de filtros */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={searchRef}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Buscar por CNPJ ou nome"
              aria-label="Buscar por CNPJ ou nome"
              className="h-9 pr-8 pl-8"
            />
            {qInput ? (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setQInput("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 font-mono text-[10px] text-muted-foreground sm:block">
                /
              </kbd>
            )}
          </div>
          <Segmented
            label="Relacionamento"
            value={filters.rel}
            onChange={(v) => setSearch({ tipo: v === "todos" ? undefined : v })}
            options={[
              { value: "todos", label: "Todos" },
              { value: "cliente", label: "Clientes" },
              { value: "fornecedor", label: "Fornecedores" },
            ]}
          />
          <Select
            value={filters.classe}
            onValueChange={(v) =>
              setSearch({ classe: v === "todas" ? undefined : (v as TaxClassification) })
            }
          >
            <SelectTrigger className="h-9 w-[220px]" aria-label="Classificação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as classificações</SelectItem>
              {CLASSIFICATIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {CLASSIFICATION_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.estrutura}
            onValueChange={(v) =>
              setSearch({ estrutura: v === "todas" ? undefined : (v as "matriz" | "filial") })
            }
          >
            <SelectTrigger className="h-9 w-[150px]" aria-label="Estrutura">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Matriz e filial</SelectItem>
              <SelectItem value="matriz">Só matrizes</SelectItem>
              <SelectItem value="filial">Só filiais</SelectItem>
            </SelectContent>
          </Select>
          <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border/70 px-3 text-xs text-muted-foreground">
            <Switch
              checked={filters.alfanumerico}
              onCheckedChange={(v) => setSearch({ alfa: v || undefined })}
              aria-label="Só CNPJs alfanuméricos"
            />
            Alfanuméricos
          </label>
        </div>

        {activeFilters ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
            <Filter className="size-3.5 text-muted-foreground" aria-hidden />
            {filters.q ? <Chip onClear={() => setQInput("")}>Busca: {filters.q}</Chip> : null}
            {filters.rel !== "todos" ? (
              <Chip onClear={() => setSearch({ tipo: undefined })}>
                {RELATIONSHIP_LABEL[filters.rel]}
              </Chip>
            ) : null}
            {filters.classe !== "todas" ? (
              <Chip onClear={() => setSearch({ classe: undefined })}>
                {CLASSIFICATION_LABEL[filters.classe]}
              </Chip>
            ) : null}
            {filters.estrutura !== "todas" ? (
              <Chip onClear={() => setSearch({ estrutura: undefined })}>
                {filters.estrutura === "matriz" ? "Matrizes" : "Filiais"}
              </Chip>
            ) : null}
            {filters.alfanumerico ? (
              <Chip onClear={() => setSearch({ alfa: undefined })}>Alfanuméricos</Chip>
            ) : null}
            {filters.importId ? (
              <Chip onClear={() => setSearch({ importacao: undefined })}>
                Importação {filters.importId.slice(0, 8)}
              </Chip>
            ) : null}
            <button
              type="button"
              className="ml-1 font-medium text-primary hover:underline"
              onClick={() => {
                setQInput("");
                setPage(0);
                void navigate({ search: {}, replace: true });
              }}
            >
              Limpar filtros
            </button>
          </div>
        ) : null}

        {q.error ? (
          <div className="p-4">
            <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
          </div>
        ) : (
          <div
            className={cn(
              "relative overflow-x-auto",
              q.isFetching && !q.isLoading && "opacity-70 transition-opacity",
            )}
          >
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-[1] bg-surface-1">
                <tr className="border-b border-border">
                  <th scope="col" className="w-10 px-3 py-2">
                    <Checkbox
                      aria-label="Selecionar a página"
                      checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                      onCheckedChange={togglePage}
                      disabled={rows.length === 0}
                    />
                  </th>
                  <SortTh k="cnpj" sort={sort} onSort={toggleSort}>
                    CNPJ
                  </SortTh>
                  <SortTh k="razao" sort={sort} onSort={toggleSort}>
                    Nome declarado
                  </SortTh>
                  <SortTh k="relationship" sort={sort} onSort={toggleSort}>
                    Tipo
                  </SortTh>
                  <SortTh k="classe" sort={sort} onSort={toggleSort}>
                    Classificação
                  </SortTh>
                  <th scope="col" className="th-label px-3 py-2 text-left">
                    UF / Município
                  </th>
                  <SortTh k="created_at" sort={sort} onSort={toggleSort} align="right">
                    Na base desde
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {q.isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td colSpan={7} className="px-3 py-2.5">
                          <Skeleton className="h-5" />
                        </td>
                      </tr>
                    ))
                  : rows.map((r) => {
                      const sel = selected.has(key(r));
                      const e = r.tax_entities;
                      return (
                        <tr
                          key={key(r)}
                          aria-selected={sel}
                          onClick={() => setDetail(r)}
                          className={cn(
                            "row-hover cursor-pointer border-b border-border/50 transition-colors",
                            sel && "bg-primary/5",
                          )}
                        >
                          <td className="px-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                            <Checkbox
                              aria-label={`Selecionar ${formatCnpj(r.cnpj)}`}
                              checked={sel}
                              onCheckedChange={() => toggleRow(r)}
                            />
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <button
                              type="button"
                              className="focus-glow rounded font-mono tabular text-[13px] hover:text-primary"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setDetail(r);
                              }}
                            >
                              {formatCnpj(r.cnpj)}
                            </button>
                            <span className="ml-2 rounded border border-border/70 px-1 py-px text-[10px] text-muted-foreground">
                              {e.is_matriz ? "Matriz" : "Filial"}
                            </span>
                            {e.cnpj_alfanumerico ? (
                              <span className="ml-1 rounded border border-primary/40 px-1 py-px text-[10px] text-primary">
                                A-Z
                              </span>
                            ) : null}
                          </td>
                          <td className="max-w-[320px] px-3 py-2.5">
                            <p className="truncate">
                              {r.declared_razao_social ?? e.razao_social ?? "—"}
                            </p>
                            {r.declared_nome_fantasia ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {r.declared_nome_fantasia}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                                r.relationship === "cliente"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-regime-real/10 text-regime-real",
                              )}
                            >
                              {RELATIONSHIP_LABEL[r.relationship]}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <ClassificationBadge
                              value={e.public_classification}
                              basis={e.public_classification_basis}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {e.uf ? `${e.uf}${e.municipio ? ` · ${e.municipio}` : ""}` : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleDateString("pt-BR")}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
            {!q.isLoading && rows.length === 0 ? (
              <div className="p-4">
                {activeFilters ? (
                  <EmptyState
                    icon={Search}
                    title="Nenhum resultado para este filtro"
                    hint="Ajuste a busca ou limpe os filtros."
                    action={
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setQInput("");
                          void navigate({ search: {}, replace: true });
                        }}
                      >
                        Limpar filtros
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Table2}
                    title="Base vazia"
                    hint="Importe a base de clientes e fornecedores para começar."
                    action={
                      <Button asChild size="sm" className="cta-lift">
                        <Link to="/t/$tenantId/tributario/importacoes" params={{ tenantId }}>
                          <Upload className="mr-2 size-4" aria-hidden /> Importar base
                        </Link>
                      </Button>
                    }
                  />
                )}
              </div>
            ) : null}
          </div>
        )}

        <Pager
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(0);
          }}
          unit="relacionamento(s)"
          loading={q.isFetching}
        />
      </Rise>

      {/* Barra de ações em lote */}
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 transition-all duration-300",
          selected.size > 0 ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        )}
      >
        {selected.size > 0 ? (
          <div className="panel pointer-events-auto flex flex-wrap items-center gap-2 px-3 py-2 shadow-2xl">
            <span className="px-1 text-sm">
              <span className="font-mono tabular font-semibold">{n(selected.size)}</span>{" "}
              selecionado(s)
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={exporting !== null}
              onClick={() => void exportRows("selecao")}
            >
              <FileSpreadsheet className="mr-2 size-4" aria-hidden /> Exportar seleção
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copySelected()}>
              <ClipboardCopy className="mr-2 size-4" aria-hidden /> Copiar CNPJs
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Map())}
              aria-label="Limpar seleção"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      <DetailSheet row={detail} tenantId={tenantId} onClose={() => setDetail(null)} />
    </Page>
  );
}

function Chip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2/60 py-0.5 pr-1 pl-2.5">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Remover filtro"
        className="rounded-full p-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

function SortTh({
  k,
  sort,
  onSort,
  children,
  align = "left",
}: {
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={cn("th-label px-3 py-2", align === "right" ? "text-right" : "text-left")}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "focus-glow inline-flex items-center gap-1 rounded hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Detalhe do CNPJ
// ---------------------------------------------------------------------------
function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm", mono && "font-mono tabular")}>{children}</dd>
    </div>
  );
}

function DetailSheet({
  row,
  tenantId,
  onClose,
}: {
  row: PortfolioRow | null;
  tenantId: string;
  onClose: () => void;
}) {
  const d = useQuery({
    enabled: Boolean(row),
    queryKey: ["tax-entity", tenantId, row?.cnpj],
    queryFn: () => loadEntityDetail(tenantId, row!.cnpj),
  });
  const parts = row ? cnpjParts(row.cnpj) : null;
  const e = row?.tax_entities;
  const importName = (id: string | null) =>
    d.data?.imports.find((i) => i.id === id)?.file_name ?? (id ? id.slice(0, 8) : "—");

  return (
    <SideSheet
      open={Boolean(row)}
      onOpenChange={(v) => !v && onClose()}
      title={row ? formatCnpj(row.cnpj) : ""}
      description={
        row ? (row.declared_razao_social ?? e?.razao_social ?? "Sem nome declarado") : undefined
      }
    >
      {row && e && parts ? (
        <Tabs defaultValue="resumo">
          <TabsList className="mb-4 grid w-full grid-cols-3">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="consultas">Consultas</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="resumo" className="space-y-5">
            <section className="panel-hero p-4">
              <p className="text-xs text-muted-foreground">Classificação pública</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ClassificationBadge
                  value={e.public_classification}
                  basis={e.public_classification_basis}
                  className="text-xs"
                />
                {e.last_consulted_at ? (
                  <span className="text-xs text-muted-foreground">
                    consultado em {dateTime(e.last_consulted_at)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    nenhuma fonte consultada ainda
                  </span>
                )}
              </div>
              {d.data && basisLines(d.data.basis).length > 0 ? (
                <dl className="mt-3 space-y-1.5 text-xs">
                  {basisLines(d.data.basis).map((l) => (
                    <div key={l.label} className="grid grid-cols-[9.5rem_1fr] gap-2">
                      <dt className="text-muted-foreground">{l.label}</dt>
                      <dd className={l.label === "Aviso" ? "text-warn" : undefined}>{l.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Estrutura do CNPJ
              </h3>
              <dl className="grid grid-cols-3 gap-2">
                <Field label="Raiz" mono>
                  {parts.raiz}
                </Field>
                <Field label="Ordem" mono>
                  {parts.ordem}
                </Field>
                <Field label="DV" mono>
                  {parts.dv}
                </Field>
                <Field label="Estabelecimento">{parts.isMatriz ? "Matriz" : "Filial"}</Field>
                <Field label="Formato">{parts.alfanumerico ? "Alfanumérico" : "Numérico"}</Field>
                <Field label="UF">{e.uf ?? "—"}</Field>
              </dl>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Cadastro na fonte pública
              </h3>
              {e.razao_social || e.situacao_cadastral || e.municipio ? (
                <dl className="grid grid-cols-2 gap-2">
                  <Field label="Razão social">{e.razao_social ?? "—"}</Field>
                  <Field label="Situação cadastral">{e.situacao_cadastral ?? "—"}</Field>
                  <Field label="Município">{e.municipio ?? "—"}</Field>
                </dl>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  Ainda sem dados cadastrais da Receita para este CNPJ.
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Na sua base
              </h3>
              {d.isLoading ? (
                <Skeleton className="h-16" />
              ) : (
                <ul className="space-y-2">
                  {(d.data?.relationships ?? [row]).map((r) => (
                    <li
                      key={key(r)}
                      className="rounded-lg border border-border/60 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{RELATIONSHIP_LABEL[r.relationship]}</span>
                        <span className="font-mono tabular text-[11px] text-muted-foreground">
                          desde {new Date(r.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.declared_razao_social ?? "—"}
                        {r.declared_nome_fantasia ? ` · ${r.declared_nome_fantasia}` : ""}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Origem: {importName(r.first_import_id)}
                        {r.last_import_id && r.last_import_id !== r.first_import_id
                          ? ` · última: ${importName(r.last_import_id)}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="consultas">
            {d.isLoading ? (
              <Skeleton className="h-24" />
            ) : d.error ? (
              <ErrorState message={(d.error as Error).message} onRetry={() => void d.refetch()} />
            ) : d.data!.consultations.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nenhuma consulta registrada"
                hint="Quando as fontes públicas forem consultadas, cada resposta aparece aqui com data e fonte."
              />
            ) : (
              <ul className="space-y-2">
                {d.data!.consultations.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{sourceName(c.source_code)}</span>
                      <span className="text-xs">{CONSULTATION_LABEL[c.status]}</span>
                    </div>
                    <p className="font-mono tabular text-[11px] text-muted-foreground">
                      {dateTime(c.consulted_at)}
                      {c.dataset_version ? ` · competência ${c.dataset_version}` : ""}
                    </p>
                    {c.error ? <p className="mt-1 text-xs text-destructive">{c.error}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="historico" className="space-y-4">
            {d.isLoading ? (
              <Skeleton className="h-24" />
            ) : d.data!.history.length === 0 && d.data!.events.length === 0 ? (
              <EmptyState
                icon={FileSpreadsheet}
                title="Sem histórico de regime"
                hint="O histórico anual (ECF) e as mudanças de regime aparecem aqui depois das consultas."
              />
            ) : (
              <>
                {d.data!.history.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="th-label py-1 text-left">
                          Ano
                        </th>
                        <th scope="col" className="th-label py-1 text-left">
                          Forma de tributação
                        </th>
                        <th scope="col" className="th-label py-1 text-left">
                          Competência
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.data!.history.map((h, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-1.5 font-mono tabular">{h.ano}</td>
                          <td className="py-1.5">{h.forma_tributacao_original}</td>
                          <td className="py-1.5 font-mono tabular">{h.dataset_version}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {d.data!.events.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {d.data!.events.map((ev, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span>{ev.event_type.replace(/_/g, " ")}</span>
                        <span className="font-mono tabular text-muted-foreground">
                          {ev.effective_date ?? dateTime(ev.detected_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </TabsContent>
        </Tabs>
      ) : null}
    </SideSheet>
  );
}

function RunBanner({ phase, tenantId }: { phase: Phase; tenantId: string }) {
  const hora = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  if (phase.kind === "rodando" || phase.kind === "na_fila") {
    const pct = phase.kind === "rodando" ? Math.max(phase.pct, 4) : 4;
    return (
      <div
        role="status"
        className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 font-medium text-foreground">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            {phase.kind === "rodando" ? "Processando com a Receita" : "Processamento na fila"}
          </span>
          {phase.kind === "rodando" ? (
            <span className="font-mono tabular text-sm font-semibold">{phase.pct}%</span>
          ) : null}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            data-active="true"
            className="proc-bar h-full rounded-full bg-primary transition-[width] duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Iniciado em {hora(phase.desde)}. As linhas abaixo se atualizam sozinhas.
        </p>
      </div>
    );
  }
  if (phase.kind === "nunca") {
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        Esta base ainda não foi processada.{" "}
        <Link to="/t/$tenantId/tributario" params={{ tenantId }} className="text-primary underline">
          Processar agora
        </Link>
      </p>
    );
  }
  return (
    <p className="mb-3 text-xs text-muted-foreground">
      {phase.kind === "concluido"
        ? `Último processamento concluído em ${hora(phase.em)} · dados da Receita de ${phase.competencia}.`
        : `Último processamento não concluiu (${phase.motivo}).`}
    </p>
  );
}
