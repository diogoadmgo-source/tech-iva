import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  credentialSemaphore,
  hasActiveDfe,
  KIND_LABEL,
  STATUS_LABEL,
  useCredentials,
  useRevokeCredential,
  useUploadCredential,
  type CredentialRow,
} from "@/lib/credentials";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/settings/integrations")({
  head: () => ({
    meta: [
      { title: "Integrações e credenciais — TECH-IVA" },
      {
        name: "description",
        content:
          "Autorize a leitura dos seus documentos fiscais por procuração eletrônica, chave de API ou certificado A1, com validade e revogação sob seu controle.",
      },
      { property: "og:title", content: "Integrações e credenciais — TECH-IVA" },
      {
        property: "og:description",
        content:
          "Procuração eletrônica recomendada: não guardamos chave privada de cliente. Certificado A1 é último recurso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPage,
});

/** CNPJ que o cliente nomeia como procurador no e-CAC. */
const PROCURADOR_CNPJ = import.meta.env["VITE_TECHIVA_PROCURADOR_CNPJ"] as string | undefined;
const ECAC_URL = "https://cav.receita.fazenda.gov.br/autenticacao/login";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface-1 p-5 ${className}`}>
      {children}
    </section>
  );
}

function IntegrationsPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const role = shell.data?.role ?? null;
  const canManage =
    role === "platform_admin" || role === "channel_admin" || role === "owner" || role === "finance";

  const credentials = useCredentials(tenantId);

  if (shell.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!canManage) {
    return (
      <NoPermissionState message="Só owner, financeiro, administrador do canal ou da plataforma podem gerenciar credenciais." />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-medium">Integrações e credenciais</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Para projetar o caixa do imposto precisamos ler seus documentos fiscais. Existem três
          caminhos. Recomendamos a procuração eletrônica porque nela usamos o{" "}
          <strong>nosso</strong> certificado — assim não guardamos chave privada de cliente nenhum.
          É uma escolha de confiança, não uma limitação técnica.
        </p>
      </header>

      <CredentialsList tenantId={tenantId} query={credentials} />

      <div className="grid gap-4 lg:grid-cols-3">
        <ProcuracaoCard tenantId={tenantId} />
        <ApiKeyCard tenantId={tenantId} />
        <CertificateCard tenantId={tenantId} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- lista */

const DOT: Record<string, string> = {
  green: "bg-flow-in",
  amber: "bg-amber-400",
  red: "bg-flow-out",
  neutral: "bg-muted-foreground",
};

function CredentialsList({
  tenantId,
  query,
}: {
  tenantId: string;
  query: ReturnType<typeof useCredentials>;
}) {
  const revoke = useRevokeCredential(tenantId);
  const [pending, setPending] = useState<CredentialRow | null>(null);
  const [reason, setReason] = useState("");

  if (query.isLoading) return <Skeleton className="h-32 w-full" />;
  if (query.isError) {
    return <ErrorState message={query.error instanceof Error ? query.error.message : "Falha."} />;
  }

  const rows = query.data ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Credenciais desta empresa</h2>
        {hasActiveDfe(rows) && (
          <Badge className="bg-flow-in/15 text-flow-in">leitura de notas autorizada</Badge>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Nenhuma credencial registrada"
            message="Comece pela procuração eletrônica, abaixo."
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => {
            const semaphore = credentialSemaphore(row);
            return (
              <li key={row.id} className="rounded-lg border border-border bg-surface-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${DOT[semaphore]}`}
                        aria-hidden
                      />
                      <span className="text-sm font-medium">{KIND_LABEL[row.kind]}</span>
                      <Badge variant="outline" className="text-xs uppercase">
                        {row.provider}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.subject_cn ? `Titular: ${row.subject_cn}. ` : ""}
                      {row.not_after
                        ? `Válido até ${new Date(`${row.not_after}T12:00:00`).toLocaleDateString("pt-BR")}${
                            row.dias_para_expirar !== null
                              ? ` (${row.dias_para_expirar} dias)`
                              : ""
                          }. `
                        : "Sem data de validade. "}
                      {row.last_used_at
                        ? `Último uso em ${new Date(row.last_used_at).toLocaleString("pt-BR")}.`
                        : "Ainda não utilizada."}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReason("");
                      setPending(row);
                    }}
                  >
                    Revogar
                  </Button>
                </div>

                {row.last_error && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-flow-out/40 bg-flow-out/10 px-3 py-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-flow-out" aria-hidden />
                    <div>
                      <p className="font-medium">Última tentativa falhou</p>
                      <p className="mt-0.5 text-muted-foreground">{row.last_error}</p>
                      <p className="mt-1 text-muted-foreground">
                        Reenvie a credencial abaixo para voltar a ingerir notas.
                      </p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar credencial</DialogTitle>
            <DialogDescription>
              A credencial deixa de valer imediatamente e o material cifrado é descartado. A
              ingestão de notas por esse caminho para até você registrar outra credencial.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Motivo (opcional)</Label>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: certificado substituído"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={async () => {
                if (!pending) return;
                try {
                  await revoke.mutateAsync({ id: pending.id, reason: reason.trim() });
                  toast.success("Credencial revogada.");
                  setPending(null);
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Falha ao revogar.";
                  toast.error(/aal2|mfa/i.test(message) ? "MFA required" : message);
                }
              }}
            >
              {revoke.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Revogar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ------------------------------------------------------ (a) procuração */

function ProcuracaoCard({ tenantId }: { tenantId: string }) {
  const upload = useUploadCredential(tenantId);
  const cnpj = PROCURADOR_CNPJ ?? null;

  return (
    <Card className="border-primary/40 ring-1 ring-primary/20">
      <div className="flex items-center gap-2">
        <FileCheck2 className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-medium">Procuração eletrônica</h3>
        <Badge className="bg-primary/15 text-primary">recomendado</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Você nos nomeia procurador no e-CAC e nós usamos o nosso próprio certificado. Nenhuma chave
        privada sua fica com o TECH-IVA.
      </p>

      <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
        <li>1. Entre no e-CAC com o certificado da empresa ou conta gov.br.</li>
        <li>2. Abra “Senhas e Procurações” → “Cadastrar/Consultar procuração”.</li>
        <li>
          3. Informe o CNPJ do procurador:{" "}
          {cnpj ? (
            <span className="inline-flex items-center gap-1">
              <code className="rounded bg-surface-2 px-1 font-mono">{cnpj}</code>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  void navigator.clipboard.writeText(cnpj);
                  toast.success("CNPJ copiado.");
                }}
              >
                <Copy className="size-3" aria-hidden />
              </button>
            </span>
          ) : (
            <span className="italic">
              solicite o CNPJ do procurador ao administrador da plataforma
            </span>
          )}
        </li>
        <li>4. Selecione os serviços de consulta de documentos fiscais e conclua.</li>
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={ECAC_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Abrir e-CAC <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      <Button
        className="mt-4 w-full"
        disabled={upload.isPending}
        onClick={async () => {
          try {
            await upload.mutateAsync({ kind: "procuracao" });
            toast.success("Procuração registrada. Vamos verificar o acesso.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Falha ao registrar.");
          }
        }}
      >
        {upload.isPending ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Check className="mr-2 size-4" />
        )}
        Já autorizei
      </Button>
    </Card>
  );
}

/* --------------------------------------------------------- (b) api key */

function ApiKeyCard({ tenantId }: { tenantId: string }) {
  const upload = useUploadCredential(tenantId);
  const [value, setValue] = useState("");

  return (
    <Card>
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-medium">Chave de API (Portal RTC)</h3>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Gere a chave no Portal RTC e cole aqui. Você pode revogá-la lá e aqui, quando quiser. A
        chave é cifrada no envio e nunca é exibida de novo.
      </p>
      <div className="mt-4 space-y-2">
        <Label htmlFor="api-key">Chave</Label>
        <Input
          id="api-key"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="cole a chave gerada no portal"
        />
        <Button
          className="w-full"
          variant="outline"
          disabled={value.trim().length < 8 || upload.isPending}
          onClick={async () => {
            try {
              await upload.mutateAsync({ kind: "api_key", apiKey: value.trim() });
              setValue("");
              toast.success("Chave registrada e cifrada.");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Falha ao registrar.");
            }
          }}
        >
          {upload.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Registrar chave
        </Button>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------- (c) certificado */

function CertificateCard({ tenantId }: { tenantId: string }) {
  const upload = useUploadCredential(tenantId);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);

  return (
    <Card>
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Certificado A1 (.pfx)</h3>
        <Badge variant="outline" className="text-xs text-muted-foreground">
          último recurso
        </Badge>
      </div>
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
        <p>
          Um certificado A1 é uma <strong>chave privada</strong> que assina em nome da sua empresa.
          Preferimos a procuração exatamente para não precisar guardá-la. Se enviar, o arquivo é
          cifrado e nunca pode ser baixado de volta — nem por nós.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-2">
          <Label htmlFor="pfx">Arquivo .pfx ou .p12</Label>
          <Input
            id="pfx"
            type="file"
            accept=".pfx,.p12"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pfx-pass">Senha do certificado</Label>
          <Input
            id="pfx-pass"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
          <span>Entendo que estou enviando um certificado digital da minha empresa.</span>
        </label>
        <Button
          className="w-full"
          variant="outline"
          disabled={!file || password.length === 0 || !ack || upload.isPending}
          onClick={async () => {
            if (!file) return;
            try {
              const result = await upload.mutateAsync({
                kind: "certificado_a1",
                file,
                password,
              });
              setFile(null);
              setPassword("");
              setAck(false);
              const notAfter =
                "notAfter" in result && result.notAfter ? ` Válido até ${result.notAfter}.` : "";
              toast.success(`Certificado validado e cifrado.${notAfter}`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Falha ao enviar certificado.");
            }
          }}
        >
          {upload.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Upload className="mr-2 size-4" />
          )}
          Enviar certificado
        </Button>
      </div>
    </Card>
  );
}
