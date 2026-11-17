import { cn } from "@/lib/utils";
import {
  CLASSIFICATION_TONE,
  classificationText,
  type TaxClassification,
} from "@/lib/tax-intel/labels";

/** Selo da classificação gravada no banco. Não deduz nada. */
export function ClassificationBadge({
  value,
  basis,
  className,
}: {
  value: TaxClassification;
  /** Base gravada no banco: dá o ano da ECF a Real/Presumido. */
  basis?: Record<string, unknown> | null | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium",
        CLASSIFICATION_TONE[value],
        className,
      )}
    >
      {value === "consulta_pendente" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" aria-hidden />
      ) : null}
      {classificationText(value, basis)}
    </span>
  );
}
