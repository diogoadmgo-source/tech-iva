import bronze from "@/assets/plan-bronze.png";
import ouro from "@/assets/plan-ouro.png";
import prata from "@/assets/plan-prata.png";
import { cn } from "@/lib/utils";

const GEMS: Record<string, { src: string; alt: string }> = {
  starter: { src: bronze, alt: "Diamante de bronze do plano Bronze" },
  pro: { src: prata, alt: "Diamante de prata do plano Prata" },
  scale: { src: ouro, alt: "Diamante de ouro do plano Ouro" },
};

/** Ícone realista de diamante metálico por plano (bronze / prata / ouro). */
export function PlanGem({
  code,
  className,
  size = 40,
}: {
  code: string | null | undefined;
  className?: string;
  size?: number;
}) {
  const gem = code ? GEMS[code] : undefined;
  if (!gem) return null;
  return (
    <img
      src={gem.src}
      alt={gem.alt}
      loading="lazy"
      width={816}
      height={816}
      style={{ width: size, height: size }}
      className={cn("shrink-0 select-none object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]", className)}
    />
  );
}
