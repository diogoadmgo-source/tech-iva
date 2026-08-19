/**
 * Cartão do certificado digital instalado.
 *
 * A informação que o cliente precisa agir é a VALIDADE — ela é o destaque. O
 * resto (titular, impressão digital, finalidades, autoria) é prova de que o
 * certificado guardado é o dele e que só será usado para o que ele autorizou.
 * Nada aqui sugere download: o material cifrado não volta, nem para nós.
 */
import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Copy,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InfoHint } from "@/components/techiva/info-hint";
import { Panel } from "@/components/techiva/page";
import {
  CERT_STATE_LABEL,
  certificateState,
  diasEmPalavras,
  FINALIDADE_CHIP,
  formatCnpj,
  formatDate,
  ROLE_LABEL,
  splitSubjectCn,
  truncateFingerprint,
  validityProgress,
  type CertificateState,
  type CredentialRow,
} from "@/lib/credentials";

const STATE_STYLE: Record<
  CertificateState,
  { badge: string; ring: string; accent: string; bar: string }
> = {
  ativo: {
    badge: "bg-flow-in/15 text-flow-in border-flow-in/30",
    ring: "border-flow-in/30",
    accent: "text-flow-in",
    bar: "bg-flow-in",
  },
  expirando: {
    badge: "bg-warning/15 text-warning border-warning/30",
    ring: "border-warning/40",
    accent: "text-warning",
    bar: "bg-warning",
  },
  expirado: {
    badge: "bg-flow-out/15 text-flow-out border-flow-out/30",
    ring: "border-flow-out/40",
    accent: "text-flow-out",
    bar: "bg-flow-out",
  },
  erro: {
    badge: "bg-flow-out/15 text-flow-out border-flow-out/30",
    ring: "border-flow-out/40",
    accent: "text-flow-out",
    bar: "bg-flow-out",
  },
  revogado: {
    badge: "bg-muted text-muted-foreground border-border",
    ring: "border-border",
    accent: "text-muted-foreground",
    bar: "bg-muted-foreground",
  },
  pendente: {
    badge: "bg-warning/15 text-warning border-warning/30",
    ring: "border-warning/30",
    accent: "text-warning",
    bar: "bg-warning",
  },
};

export function CertificateStatusCard({
  row,
  onReplace,
  onRevoke,
  onRetry,
  onOpenUsage,
}: {
  row: CredentialRow;
  onReplace?: (() => void) | undefined;
  onRevoke?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onOpenUsage?: (() => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const state = certificateState(row);
  const style = STATE_STYLE[state];
  const { razaoSocial, cnpj } = splitSubjectCn(row.subject_cn, row.subject_cnpj);
  const falhas = row.falhas_consecutivas ?? 0;
  const progresso = validityProgress(row);

  return (
    <Panel
      className={style.ring}
      icon={ShieldCheck}
      title="Certificado digital A1"
      help={
        <>
          <p>
            Mostramos primeiro a <strong>validade</strong>, que é o que exige ação. O restante prova
            que o certificado guardado é seu e só é usado para o que você autorizou.
          </p>
          <p>O material cifrado nunca pode ser baixado, nem por nós.</p>
        </>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={`text-[11px] ${style.badge}`}>
            {CERT_STATE_LABEL[state]}
          </Badge>
          <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">
            {row.provider}
          </Badge>
        </div>
      }
    >
      {/* destaque: validade */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Validade</p>
        <p className="mt-1 text-lg font-medium tracking-tight sm:text-xl">
          Válido até {formatDate(row.not_after)}{" "}
          <span className={`text-sm font-normal sm:text-base ${style.accent}`}>
            · {diasEmPalavras(row.dias_para_expirar)}
          </span>
        </p>
        <div
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={progresso}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Período de validade já decorrido"
        >
          <div
            className={`h-full rounded-full ${style.bar} transition-[width] duration-700`}
            style={{ width: `${progresso}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {row.not_before ? `Emitido em ${formatDate(row.not_before)} · ` : ""}
          {progresso}% do período de validade já passou
        </p>

        {state === "expirando" && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              Renove antes de {formatDate(row.not_after)} para não interromper a ingestão dos seus
              documentos fiscais.
            </span>
          </p>
        )}
        {state === "expirado" && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-flow-out/40 bg-flow-out/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-flow-out" aria-hidden />
            <span>A ingestão está parada desde {formatDate(row.not_after)}. Envie o certificado renovado.</span>
          </p>
        )}
      </div>

      {/* titular */}
      <div className="mt-5 rounded-lg border border-border bg-surface-2 px-3 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Titular</p>
        <p className="mt-1 text-sm">{razaoSocial ?? "não informado"}</p>
        {cnpj && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{formatCnpj(cnpj)}</p>}
        {row.titular_confere === true && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-flow-in">
            <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
            Titular confere com o CNPJ desta empresa
          </p>
        )}
      </div>

      {/* impressão digital */}
      {row.fingerprint && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Impressão digital (SHA-256)
            </p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mt-0.5 block cursor-help font-mono text-xs">
                    {truncateFingerprint(row.fingerprint)}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs break-all font-mono text-[11px]">
                  {row.fingerprint}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(row.fingerprint!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
              toast.success("Impressão digital copiada.");
            }}
          >
            {copied ? (
              <Check className="mr-1 size-3.5" aria-hidden />
            ) : (
              <Copy className="mr-1 size-3.5" aria-hidden />
            )}
            Copiar
          </Button>
        </div>
      )}

      {/* finalidades */}
      {(row.finalidades?.length ?? 0) > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-muted-foreground">Este certificado só pode ser usado para:</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.finalidades!.map((f) => (
              <Badge key={f} variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                {FINALIDADE_CHIP[f] ?? f}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* uso */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {row.last_used_at
            ? `Último uso em ${new Date(row.last_used_at).toLocaleString("pt-BR")}${
                row.last_used_finalidade
                  ? ` · ${FINALIDADE_CHIP[row.last_used_finalidade] ?? row.last_used_finalidade}`
                  : ""
              }`
            : "Ainda não utilizado"}
        </span>
        {onOpenUsage && (
          <button type="button" className="text-primary hover:underline" onClick={onOpenUsage}>
            ver extrato de uso
          </button>
        )}
      </div>

      {/* falhas */}
      {state === "erro" ? (
        <div className="mt-4 rounded-lg border border-flow-out/40 bg-flow-out/10 px-3 py-2 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-flow-out">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            Falhou em {Math.max(falhas, 3)} tentativas seguidas. Ingestão pausada.
          </p>
          {row.last_error && <p className="mt-1 text-muted-foreground">{row.last_error}</p>}
          {onRetry && (
            <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
              <RotateCcw className="mr-1 size-3.5" aria-hidden />
              Testar novamente
            </Button>
          )}
        </div>
      ) : (
        falhas > 0 && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            {falhas} falha{falhas === 1 ? "" : "s"} recente{falhas === 1 ? "" : "s"}
            <InfoHint title="Falhas recentes">
              <p>Tentaremos novamente. O contador zera no primeiro sucesso.</p>
            </InfoHint>
          </p>
        )
      )}

      {/* autoria */}
      {row.uploaded_on_behalf && (
        <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
          Enviado por {ROLE_LABEL[row.uploaded_by_role ?? ""] ?? row.uploaded_by_role ?? "usuário da plataforma"}
          {row.created_at ? ` em ${formatDate(row.created_at)}` : ""}, em nome da empresa.
        </p>
      )}

      {/* ações */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {onReplace && (
          <Button size="sm" variant="outline" onClick={onReplace}>
            <Upload className="mr-1 size-3.5" aria-hidden />
            Substituir certificado
          </Button>
        )}
        {onRevoke && (
          <Button size="sm" variant="ghost" className="text-flow-out hover:text-flow-out" onClick={onRevoke}>
            Revogar
          </Button>
        )}
        <InfoHint title="Substituir certificado">
          <p>
            Substituir envia um novo certificado que passa a valer no lugar do atual. O material
            guardado nunca pode ser baixado.
          </p>
        </InfoHint>
      </div>
    </Panel>
  );
}
