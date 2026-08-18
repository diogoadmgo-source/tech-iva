/**
 * Fundo vivo do ambiente público (landing e auth).
 * Movimento contínuo, lento e sóbrio: feixes de luz que atravessam a tela,
 * malha de linhas que respira e partículas que sobem devagar.
 * Só transform/opacity — nada que force layout. Pausa em prefers-reduced-motion.
 */
export function AmbientBackdrop() {
  return (
    <div aria-hidden className="auth-backdrop">
      {/* malha de linhas em perspectiva, deslizando devagar */}
      <svg className="auth-mesh" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="ambient-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.6 0.18 264)" stopOpacity="0" />
            <stop offset="50%" stopColor="oklch(0.72 0.16 264)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="oklch(0.6 0.18 264)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="url(#ambient-line)" fill="none" strokeWidth="1">
          {Array.from({ length: 9 }).map((_, i) => (
            <path
              key={i}
              d={`M -100 ${120 + i * 70} C 300 ${60 + i * 74} 900 ${200 + i * 66} 1300 ${100 + i * 72}`}
              className="auth-mesh-line"
              style={{ animationDelay: `${i * -1.7}s`, opacity: 0.5 - i * 0.03 }}
            />
          ))}
        </g>
      </svg>

      {/* dois feixes largos que varrem o fundo em ciclos longos */}
      <span className="auth-beam auth-beam-a" />
      <span className="auth-beam auth-beam-b" />

      {/* partículas de luz subindo */}
      <div className="auth-motes">
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="auth-mote"
            style={{
              left: `${(i * 7.3 + 4) % 100}%`,
              animationDelay: `${i * -2.1}s`,
              animationDuration: `${16 + (i % 5) * 4}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
