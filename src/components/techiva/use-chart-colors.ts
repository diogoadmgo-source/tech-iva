import { useEffect, useState } from "react";

const FALLBACK = {
  border: "#252b3b",
  muted: "#8b93a7",
  primary: "#2563eb",
  flowIn: "#22c55e",
  flowOut: "#f97316",
};

/**
 * Recharts recebe cores como atributos SVG; `var(--token)` não é resolvido de forma
 * confiável nesse contexto, então lemos os tokens computados após a hidratação.
 */
export function useChartColors() {
  const [colors, setColors] = useState(FALLBACK);

  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
    setColors({
      border: read("--border", FALLBACK.border),
      muted: read("--muted-foreground", FALLBACK.muted),
      primary: read("--primary", FALLBACK.primary),
      flowIn: read("--flow-in", FALLBACK.flowIn),
      flowOut: read("--flow-out", FALLBACK.flowOut),
    });
  }, []);

  return colors;
}
