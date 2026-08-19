import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: string[];
  current: number;
  className?: string | undefined;
}) {
  return (
    <ol className={cn("flex items-center gap-2 overflow-x-auto pb-1 sm:gap-3", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex shrink-0 items-center gap-2 sm:flex-1 sm:gap-3">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border/70 text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                "truncate text-xs sm:text-sm",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {step}
            </span>
            {i < steps.length - 1 && (
              <span className="hidden h-px flex-1 bg-border/60 sm:inline-block" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
