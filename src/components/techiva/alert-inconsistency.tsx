import { ClassTribFeedback } from "@/components/techiva/rtc";
import { useValidateClassTrib } from "@/lib/rtc";

/**
 * Alerta 'inconsistent_item': mostra a validação oficial da combinação
 * CST × cClassTrib apontada no payload, com as sugestões da Receita.
 */
export function InconsistentItemValidation({
  payload,
}: {
  payload: Record<string, unknown> | null;
}) {
  const cst = asText(payload?.["cst"]);
  const cclasstrib = asText(payload?.["cclasstrib"]);
  const validation = useValidateClassTrib(cst, cclasstrib);

  if (!cst || !cclasstrib) {
    return (
      <p className="text-xs text-muted-foreground">
        O alerta não trouxe CST e cClassTrib. Abra o item na nota para ver a memória de cálculo.
      </p>
    );
  }

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Classificação apontada: <code className="font-mono">CST {cst}</code> ×{" "}
        <code className="font-mono">{cclasstrib}</code>
      </p>
      <ClassTribFeedback result={validation.data} loading={validation.isFetching} />
    </section>
  );
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
