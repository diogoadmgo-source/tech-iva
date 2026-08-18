import { AlertTriangle, BadgeCheck, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { RegimeBadge, type RegimeKind } from "@/components/techiva/badges";
import {
  PRESUMIDO_DISCLAIMER,
  isSituacaoAtiva,
  useResolveCnpj,
  type CnpjRecord,
} from "@/lib/cnpj";
import { isValidCnpj } from "@/lib/onboarding";

/** Selo de campo preenchido pela Receita — o usuário pode editar por cima. */
export function FromRegistryHint({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <BadgeCheck className="size-3 text-primary" aria-hidden />
      Preenchido pela Receita — editável
    </span>
  );
}

export function formatCnpj(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/**
 * Campo de CNPJ com consulta ao cadastro público: busca no cache (cnpj_lookup) e,
 * se faltar ou estiver vencido, dispara a busca externa e reconsulta.
 */
export function CnpjAutofillField({
  id = "cnpj",
  label = "CNPJ",
  value,
  onChange,
  onResolved,
  disabled,
  autoLookup = true,
  className,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onResolved: (record: CnpjRecord) => void;
  disabled?: boolean | undefined;
  autoLookup?: boolean | undefined;
  className?: string | undefined;
}) {
  const digits = value.replace(/\D/g, "");
  const valid = digits.length === 14 && isValidCnpj(digits);
  const partialInvalid = digits.length > 0 && digits.length === 14 && !valid;
  const { resolve, state, record, message, loading } = useResolveCnpj();

  async function run() {
    const found = await resolve(digits);
    if (found) onResolved(found);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(formatCnpj(e.target.value))}
          onBlur={() => {
            if (autoLookup && valid && state === "idle") void run();
          }}
          placeholder="00.000.000/0000-00"
          className="font-mono tabular"
          aria-invalid={partialInvalid}
          inputMode="numeric"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!valid || loading || disabled}
          onClick={() => void run()}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          <span className="ml-2 hidden sm:inline">Buscar</span>
        </Button>
      </div>

      {partialInvalid && (
        <p className="text-xs text-destructive">Dígitos verificadores não conferem.</p>
      )}
      {state === "not_found" && (
        <p className="text-xs text-warn">
          {message ?? "CNPJ não encontrado na base pública."} Preencha os dados manualmente.
        </p>
      )}
      {state === "error" && (
        <p className="text-xs text-destructive">{message ?? "Falha ao consultar a Receita."}</p>
      )}
      {state === "found" && record && <RegistrySummary record={record} />}
    </div>
  );
}

/** Resumo do que veio do cadastro público, com aviso de situação cadastral e do regime. */
export function RegistrySummary({
  record,
  compact = false,
}: {
  record: CnpjRecord;
  compact?: boolean | undefined;
}) {
  const ativa = isSituacaoAtiva(record.situacao);
  const regime = (record.regime ?? "desconhecido") as RegimeKind;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeCheck className="size-3.5 text-primary" aria-hidden />
        <span className="text-xs font-medium">{record.razao_social ?? "Sem razão social"}</span>
        <RegimeBadge regime={regime} />
        {record.situacao && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
              ativa
                ? "border-border text-muted-foreground"
                : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            {!ativa && <AlertTriangle className="size-3" aria-hidden />}
            {record.situacao}
          </span>
        )}
      </div>

      {!ativa && record.situacao && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          Situação cadastral não é ATIVA. Notas emitidas para este CNPJ podem ser recusadas e o
          crédito pode não ser aproveitado.
        </p>
      )}

      {!compact && (
        <dl className="grid gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
          {record.nome_fantasia && <Row label="Nome fantasia" value={record.nome_fantasia} />}
          {record.porte && <Row label="Porte" value={record.porte} />}
          {record.cnae_principal && (
            <Row
              label="CNAE"
              value={`${record.cnae_principal}${record.cnae_principal_desc ? ` — ${record.cnae_principal_desc}` : ""}`}
            />
          )}
          {record.natureza_juridica && (
            <Row label="Natureza jurídica" value={record.natureza_juridica} />
          )}
          {(record.municipio || record.uf) && (
            <Row label="Município" value={[record.municipio, record.uf].filter(Boolean).join(" / ")} />
          )}
          {record.abertura && (
            <Row label="Abertura" value={new Date(record.abertura).toLocaleDateString("pt-BR")} />
          )}
          {record.fetched_at && (
            <Row
              label="Consultado em"
              value={new Date(record.fetched_at).toLocaleString("pt-BR")}
            />
          )}
        </dl>
      )}

      {regime === "presumido" && (
        <p className="text-[11px] text-muted-foreground">{PRESUMIDO_DISCLAIMER}</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 font-medium text-foreground/70">{label}:</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
