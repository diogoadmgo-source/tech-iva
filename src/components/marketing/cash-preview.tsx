import { useEffect, useRef, useState } from "react";

/**
 * Miniatura do gráfico de caixa do produto: imposto que sai, crédito que volta
 * e a linha de saldo. O ciclo de animação roda UMA vez, quando o gráfico entra
 * na viewport, e para no estado final. Só transform/opacity e stroke-dashoffset.
 * Valores ilustrativos, marcados como tal.
 */

const WEEKS = [
  { label: "S1", out: 46, in: 24, saldo: 118 },
  { label: "S2", out: 62, in: 30, saldo: 104 },
  { label: "S3", out: 54, in: 41, saldo: 96 },
  { label: "S4", out: 78, in: 36, saldo: 72 },
  { label: "S5", out: 68, in: 52, saldo: 80 },
  { label: "S6", out: 88, in: 44, saldo: 58 },
];

const BASE_Y = 132;
const X0 = 34;
const STEP = 60;

/** Azul da marca nas duas séries; o verde fica reservado ao crédito. */
const COLOR_OUT = "var(--primary)";
const COLOR_IN = "var(--brand-glow)";

export function CashPreview() {
  const linePoints = WEEKS.map((w, i) => `${X0 + i * STEP + 9},${BASE_Y - w.saldo}`).join(" ");
  const ref = useRef<HTMLElement | null>(null);
  const [run, setRun] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setRun(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRun(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <figure
      ref={ref as never}
      data-run={run ? "true" : "false"}
      className="cash-anim surface-lit overflow-hidden rounded-2xl p-5"
    >
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary uppercase">
          projeção de caixa
        </span>
        <span className="text-[11px] text-muted-foreground">semana a semana</span>
      </figcaption>

      <svg
        viewBox="0 0 380 168"
        role="img"
        aria-label="Miniatura ilustrativa da projeção semanal de imposto a pagar, crédito a recuperar e saldo."
        className="mt-4 w-full"
      >
        {[0, 1, 2, 3].map((g) => (
          <line
            key={g}
            x1="20"
            x2="366"
            y1={BASE_Y - g * 34}
            y2={BASE_Y - g * 34}
            stroke="var(--border)"
            strokeWidth="1"
          />
        ))}

        {WEEKS.map((w, i) => {
          const x = X0 + i * STEP;
          const delay = `${i * 90}ms`;
          return (
            <g key={w.label}>
              <rect
                className="cash-bar"
                style={{ animationDelay: delay }}
                x={x - 12}
                y={BASE_Y - w.out}
                width="11"
                height={w.out}
                rx="2"
                fill={COLOR_OUT}
                opacity="0.95"
              />
              <rect
                className="cash-bar"
                style={{ animationDelay: `calc(${delay} + 70ms)` }}
                x={x + 2}
                y={BASE_Y - w.in}
                width="11"
                height={w.in}
                rx="2"
                fill={COLOR_IN}
                opacity="0.6"
              />
              <text
                x={x}
                y={BASE_Y + 16}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {w.label}
              </text>
            </g>
          );
        })}

        <polyline
          className="cash-line"
          points={linePoints}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {WEEKS.map((w, i) => (
          <circle
            key={`p-${w.label}`}
            className="cash-fade"
            style={{ animationDelay: `calc(1200ms + ${i * 60}ms)` }}
            cx={X0 + i * STEP + 9}
            cy={BASE_Y - w.saldo}
            r="2.5"
            fill="var(--primary)"
          />
        ))}
      </svg>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-[11px]">
        <Legend color={COLOR_OUT} label="Imposto a pagar" value="R$ 88.400" />
        <Legend color={COLOR_IN} label="Crédito a recuperar" value="R$ 44.100" />
        <Legend color="var(--primary)" label="Diferença no caixa" value="− R$ 44.300" />
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Ilustração da tela de caixa. Na sua conta, os números vêm das suas notas.
      </p>
    </figure>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="tabular mt-1 block font-mono text-foreground">{value}</span>
    </div>
  );
}
