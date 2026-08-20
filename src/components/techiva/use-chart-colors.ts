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

const REGIME_FALLBACK: Record<string, string> = {
  simples: "#7c4dff",
  simples_hibrido: "#a78bfa",
  presumido: "#38bdf8",
  real: "#2dd4bf",
  mei: "#8b93a7",
  pf: "#a1a8bb",
  imune: "#8b93a7",
  desconhecido: "#5b6479",
};

const REGIME_TOKEN: Record<string, string> = {
  simples: "--regime-simples",
  simples_hibrido: "--regime-hibrido",
  presumido: "--regime-presumido",
  real: "--regime-real",
  mei: "--regime-mei",
  pf: "--regime-pf",
  imune: "--regime-mei",
  desconhecido: "--regime-pf",
};

/**
 * Cores por regime tributário, lidas dos tokens --regime-* do styles.css.
 * A leitura acontece após a hidratação porque Recharts recebe cor como atributo SVG.
 */
export function useRegimeColors() {
  const [colors, setColors] = useState(REGIME_FALLBACK);

  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const [regime, token] of Object.entries(REGIME_TOKEN)) {
      next[regime] = s.getPropertyValue(token).trim() || REGIME_FALLBACK[regime]!;
    }
    setColors(next);
  }, []);

  return colors;
}
