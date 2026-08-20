import { FlaskConical } from "lucide-react";

import { InfoHint } from "@/components/techiva/info-hint";
import { getPaddleEnvironment } from "@/lib/paddle";

/** Selo discreto de ambiente de teste — desaparece sozinho em produção. */
export function PaymentTestBadge() {
  if (getPaddleEnvironment() !== "sandbox") return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning">
      <FlaskConical className="size-3.5" aria-hidden />
      Modo de teste
      <InfoHint title="Modo de teste" className="size-4">
        <p>
          Nenhuma cobrança real acontece na pré-visualização. Use o cartão de teste{" "}
          <strong>4242 4242 4242 4242</strong>, qualquer validade futura e CVC de 3 dígitos. Ao
          publicar o app, o mesmo fluxo passa a cobrar de verdade.
        </p>
      </InfoHint>
    </span>
  );
}
