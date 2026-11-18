import { Link } from "@tanstack/react-router";
import { FileSpreadsheet, Gauge, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { to: "/t/$tenantId/tributario", label: "Visão geral", icon: Gauge, exact: true },
  { to: "/t/$tenantId/tributario/carteira", label: "Base de CNPJs", icon: Table2, exact: false },
  {
    to: "/t/$tenantId/tributario/importacoes",
    label: "Importações",
    icon: FileSpreadsheet,
    exact: false,
  },
] as const;

/** Navegação interna do módulo: três telas, uma linha. */
export function ModuleTabs({ tenantId }: { tenantId: string }) {
  return (
    <nav
      aria-label="Inteligência Tributária"
      className="rise flex gap-1 overflow-x-auto border-b border-border/60"
    >
      {TABS.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          params={{ tenantId }}
          activeOptions={{ exact: t.exact }}
          className={cn(
            "focus-glow group relative inline-flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
            "data-[status=active]:font-medium data-[status=active]:text-foreground",
          )}
        >
          <t.icon className="size-4" aria-hidden />
          {t.label}
          <span
            aria-hidden
            className="absolute inset-x-2 -bottom-px h-0.5 scale-x-0 rounded-full bg-primary transition-transform duration-300 group-data-[status=active]:scale-x-100"
          />
        </Link>
      ))}
    </nav>
  );
}
