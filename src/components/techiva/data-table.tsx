import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { Pager } from "./pager";

export type Density = "compact" | "normal";

function toCsv<T>(columns: ColumnDef<T, unknown>[], rows: T[]) {
  const keys = columns
    .map((c) => ("accessorKey" in c ? String(c.accessorKey) : undefined))
    .filter(Boolean) as string[];
  const head = keys.join(";");
  const body = rows
    .map((r) =>
      keys
        .map((k) => {
          const v = (r as Record<string, unknown>)[k];
          return v === null || v === undefined ? "" : String(v).replace(/;/g, ",");
        })
        .join(";"),
    )
    .join("\n");
  return `${head}\n${body}`;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  searchPlaceholder = "Buscar…",
  emptyTitle = "Nada por aqui",
  emptyHint,
  exportName,
  density: densityProp,
  className,
  serverPagination,
  serverSearch,
  virtualize,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean | undefined;
  searchPlaceholder?: string | undefined;
  emptyTitle?: string | undefined;
  emptyHint?: string | undefined;
  exportName?: string | undefined;
  density?: Density | undefined;
  className?: string | undefined;
  /**
   * Paginação de servidor. Quando presente, `data` é APENAS a página atual e o
   * total exibido vem do count exato do banco — a tabela não filtra nem ordena
   * no cliente aquilo que não carregou.
   */
  serverPagination?:
    | {
        page: number;
        pageSize: number;
        total: number;
        unit?: string | undefined;
        onPageChange: (page: number) => void;
        onPageSizeChange?: ((size: number) => void) | undefined;
      }
    | undefined;
  /** Busca no servidor (controlada). Desliga o filtro local. */
  serverSearch?:
    | { value: string; onChange: (value: string) => void }
    | undefined;
  /** Virtualiza as linhas: obrigatório para páginas grandes. */
  virtualize?: boolean | undefined;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [density, setDensity] = useState<Density>(densityProp ?? "normal");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: serverSearch ? "" : globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;
  const cellPad = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";
  const rowHeight = density === "compact" ? 34 : 44;

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = (virtualize ?? rows.length > 120) && !loading;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: shouldVirtualize,
  });
  const virtualRows = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const padTop = shouldVirtualize ? (virtualRows[0]?.start ?? 0) : 0;
  const padBottom = shouldVirtualize
    ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
    : 0;
  const visibleRows = shouldVirtualize ? virtualRows.map((v) => rows[v.index]!) : rows;
  const colCount = table.getAllLeafColumns().length;

  const csv = useMemo(() => (exportName ? toCsv(columns, data) : ""), [columns, data, exportName]);

  function download() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = serverPagination
      ? `${exportName}-pagina-${serverPagination.page + 1}.csv`
      : `${exportName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={cn("rounded-xl border border-border bg-surface-1 shadow-e1", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={serverSearch ? serverSearch.value : globalFilter}
            onChange={(e) =>
              serverSearch ? serverSearch.onChange(e.target.value) : setGlobalFilter(e.target.value)
            }
            placeholder={searchPlaceholder}
            className="h-8 pl-8 text-sm"
            aria-label="Buscar na tabela"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDensity((d) => (d === "compact" ? "normal" : "compact"))}
        >
          {density === "compact" ? "Densidade normal" : "Densidade compacta"}
        </Button>
        {exportName && (
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <Download className="size-4" aria-hidden /> CSV
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="max-h-[32rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "border-b border-border text-left text-xs font-medium text-muted-foreground",
                        cellPad,
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" && <ArrowUp className="size-3" aria-hidden />}
                          {sorted === "desc" && <ArrowDown className="size-3" aria-hidden />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {table.getAllLeafColumns().map((c) => (
                    <td key={c.id} className={cellPad}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && padTop > 0 && (
              <tr aria-hidden style={{ height: padTop }}>
                <td colSpan={colCount} />
              </tr>
            )}
            {!loading &&
              visibleRows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cellPad}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && padBottom > 0 && (
              <tr aria-hidden style={{ height: padBottom }}>
                <td colSpan={colCount} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {serverPagination && (
        <Pager
          page={serverPagination.page}
          pageSize={serverPagination.pageSize}
          total={serverPagination.total}
          unit={serverPagination.unit}
          loading={loading}
          onPageChange={serverPagination.onPageChange}
          onPageSizeChange={serverPagination.onPageSizeChange}
        />
      )}

      {!loading && rows.length === 0 && (
        <div className="p-4">
          <EmptyState title={emptyTitle} hint={emptyHint} />
        </div>
      )}
    </div>
  );
}
