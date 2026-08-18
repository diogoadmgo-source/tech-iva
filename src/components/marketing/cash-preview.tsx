/**
 * Miniatura do gráfico de caixa do produto: imposto que sai, crédito que volta
 * e a linha de saldo. Animação em loop lento (7s) só com transform/opacity e
 * stroke-dashoffset — nunca layout. Valores ilustrativos, marcados como tal.
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

export function CashPreview() {
  const linePoints = WEEKS.map((w, i) => `${X0 + i * STEP + 9},${BASE_Y - w.saldo}`).join(" ");

  return (
    <figure className="surface-lit overflow-hidden rounded-2xl p-5">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] tracking-[0.28em] text-primary uppercase">
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
          const delay = `${i * 220}ms`;
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
                fill="var(--flow-out)"
                opacity="0.9"
              />
              <rect
                className="cash-bar"
                style={{ animationDelay: `calc(${delay} + 90ms)` }}
                x={x + 2}
                y={BASE_Y - w.in}
                width="11"
                height={w.in}
                rx="2"
                fill="var(--flow-in)"
                opacity="0.85"
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
            style={{ animationDelay: `${i * 90}ms` }}
            cx={X0 + i * STEP + 9}
            cy={BASE_Y - w.saldo}
            r="2.5"
            fill="var(--primary)"
          />
        ))}
      </svg>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-[11px]">
        <Legend color="var(--flow-out)" label="Imposto a pagar" value="R$ 88.400" />
        <Legend color="var(--flow-in)" label="Crédito a recuperar" value="R$ 44.100" />
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
