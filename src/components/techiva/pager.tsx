import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAGE_SIZE_OPTIONS, pageLabel } from "@/lib/paginate";
import { cn } from "@/lib/utils";

/**
 * Rodapé de paginação de servidor. O total vem SEMPRE do `count: "exact"` do
 * banco — nunca do tamanho do array carregado, senão uma empresa com 100 mil
 * notas veria "1.000 notas" e acreditaria.
 */
export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  unit = "registro(s)",
  loading,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: ((size: number) => void) | undefined;
  unit?: string | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount - 1);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>
        {pageLabel({ page: current, pageSize, total })} {unit}
        {loading && " · carregando…"}
      </span>

      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-7 w-28 text-xs" aria-label="Linhas por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} por página
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="tabular-nums">
          página {current + 1} de {pageCount.toLocaleString("pt-BR")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={current === 0 || loading}
          onClick={() => onPageChange(current - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={current >= pageCount - 1 || loading}
          onClick={() => onPageChange(current + 1)}
          aria-label="Próxima página"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
