import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotices, type Notice } from "@/lib/notices";
import { cn } from "@/lib/utils";

/** Corpo do aviso: texto vem do banco, respeitando quebras de linha e passos. */
export function NoticeBody({ body, className = "" }: { body: string; className?: string }) {
  return (
    <div className={`space-y-1 whitespace-pre-line text-xs text-muted-foreground ${className}`}>
      {body}
    </div>
  );
}

/**
 * Chip de aviso: na tela aparece só o título; o texto inteiro fica no balão.
 * Nenhum parágrafo de aviso ocupa a página.
 */
function NoticeChip({ notice, highlight = false }: { notice: Notice; highlight?: boolean }) {
  const warning = notice.severity === "warning" || notice.severity === "critical" || highlight;
  const Icon = warning ? AlertTriangle : Info;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("hint-pill focus-glow", warning && "hint-pill-warn")}
        >
          <Icon
            className={cn("size-3.5 shrink-0", warning ? "text-amber-400" : "text-muted-foreground")}
            aria-hidden
          />
          <span className="truncate">{notice.title}</span>
          <span
            aria-hidden
            className="grid size-4 shrink-0 place-items-center rounded-full border border-current/40 text-[9px] leading-none opacity-70"
          >
            ?
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="panel w-[min(24rem,calc(100vw-2rem))] border-border/70 p-4"
      >
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          <Icon className={cn("size-3.5", warning ? "text-amber-400" : "text-primary")} aria-hidden />
          <span className={warning ? "text-amber-300" : "text-primary"}>{notice.title}</span>
        </p>
        <NoticeBody body={notice.body} className="leading-relaxed" />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Avisos ativos de um escopo (notices_for) em uma única linha de chips.
 * Warning ganha cor de atenção e vem primeiro. Nenhum texto é hardcoded aqui.
 */
export function NoticeBoard({
  scope,
  className = "",
  highlightKeys = [],
  maxVisible = 3,
}: {
  scope: string;
  className?: string;
  highlightKeys?: string[];
  /** Quantos avisos ficam na tela; o resto recolhe atrás de "+N avisos". */
  maxVisible?: number;
}) {
  const notices = useNotices(scope);
  const [expanded, setExpanded] = useState(false);

  if (notices.isLoading) return <Skeleton className={`h-8 w-64 ${className}`} />;
  if (notices.isError || (notices.data?.length ?? 0) === 0) return null;

  const isHighlighted = (key: string) => highlightKeys.includes(key);
  const weight = (n: Notice) =>
    (isHighlighted(n.key) ? 4 : 0) +
    (n.severity === "critical" ? 3 : n.severity === "warning" ? 2 : 0);
  const ordered = [...(notices.data ?? [])].sort((a, b) => weight(b) - weight(a));
  const shown = expanded ? ordered : ordered.slice(0, maxVisible);
  const hidden = ordered.length - shown.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {shown.map((n) => (
        <NoticeChip key={n.key} notice={n} highlight={isHighlighted(n.key)} />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          className="hint-pill focus-glow"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
        >
          +{hidden} aviso{hidden > 1 ? "s" : ""}
        </button>
      ) : null}
      {expanded && ordered.length > maxVisible ? (
        <button
          type="button"
          className="hint-pill focus-glow"
          onClick={() => setExpanded(false)}
          aria-expanded
        >
          Recolher avisos
        </button>
      ) : null}
    </div>
  );
}
