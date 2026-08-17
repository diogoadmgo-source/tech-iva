import { cn } from "@/lib/utils";

type Json = Record<string, unknown> | null | undefined;

function fmt(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Comparação campo a campo entre estado anterior e posterior (auditoria). */
export function DiffJson({
  before,
  after,
  className,
}: {
  before: Json;
  after: Json;
  className?: string | undefined;
}) {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).sort();
  if (keys.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>Sem dados de estado.</p>;
  }
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Campo</th>
            <th className="px-3 py-2 text-left font-medium">Antes</th>
            <th className="px-3 py-2 text-left font-medium">Depois</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const b = (before ?? {})[k];
            const a = (after ?? {})[k];
            const changed = fmt(b) !== fmt(a);
            return (
              <tr key={k} className={cn("border-t border-border/60", changed && "bg-primary/5")}>
                <td className="px-3 py-1.5 font-mono">{k}</td>
                <td className={cn("px-3 py-1.5 font-mono", changed && "text-flow-out")}>{fmt(b)}</td>
                <td className={cn("px-3 py-1.5 font-mono", changed && "text-flow-in")}>{fmt(a)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
