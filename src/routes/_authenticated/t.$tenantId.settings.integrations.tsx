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

import { CertificateStatusCard } from "@/components/techiva/certificate-card";
import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { NoticeBody } from "@/components/techiva/notices";
import { Page, PageHeader, Panel, Rise, Segmented } from "@/components/techiva/page";
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
  FINALIDADE_LABEL,
  FINALIDADES_PADRAO,
  hasActiveDfe,
  KIND_LABEL,
  STATUS_LABEL,
  useCredentials,
  useCredentialUsage,
  useRevokeCredential,
  useUploadCredential,
  type CredentialRow,
} from "@/lib/credentials";
import {
  useNotices,
  usePlatformIdentity,
  useRtcCredentialState,
  type Notice,
  type RtcCredentialState,
} from "@/lib/notices";
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

function IntegrationsPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const role = shell.data?.role ?? null;
  const canManage =
    role === "platform_admin" || role === "channel_admin" || role === "owner" || role === "finance";

  const credentials = useCredentials(tenantId);
  const [tab, setTab] = useState("credenciais");


  if (shell.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!canManage) {
    return (
      <NoPermissionState hint="Só owner, financeiro, administrador do canal ou da plataforma podem gerenciar credenciais." />
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="INTEGRAÇÕES"
        title="Integrações e credenciais"
        help={
          <>
            <p>
              Para projetar o caixa do imposto precisamos ler seus documentos fiscais. Existem três
              caminhos possíveis.
            </p>
            <p>
              Recomendamos a <strong>procuração eletrônica</strong> porque nela usamos o{" "}
              <strong>nosso</strong> certificado — assim não guardamos chave privada de cliente
              nenhum. É uma escolha de confiança, não uma limitação técnica.
            </p>
          </>
        }
      />

      <Rise index={1}>
        <Segmented
          label="Seção de credenciais"
          value={tab}
          onChange={setTab}
          options={[
            { value: "credenciais", label: "Credenciais desta empresa" },
            { value: "uso", label: "Onde foi usado" },
          ]}
        />
      </Rise>

      {tab === "credenciais" ? (
        <Rise index={2}>
          <CredentialsList tenantId={tenantId} query={credentials} onOpenUsage={() => setTab("uso")} />
        </Rise>
      ) : (
        <Rise index={2}>
          <Panel
            title="Onde meu certificado foi usado"
            icon={ShieldCheck}
            help={
              <>
                <p>
                  Toda vez que usamos a sua credencial, registramos: quando, para quê e se deu
                  certo. Você não precisa confiar na nossa palavra — confira aqui.
                </p>
                <p>
                  Mostramos os últimos 90 dias. Esta trilha é somente leitura: nem você nem nós
                  podemos editá-la pelo aplicativo.
                </p>
              </>
            }
          >
            <UsageTab tenantId={tenantId} />
          </Panel>
        </Rise>
      )}

      <Rise index={3} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProcuracaoCard tenantId={tenantId} />
        <ApiKeyCard tenantId={tenantId} />
        <CertificateCard tenantId={tenantId} />
      </Rise>

      <Rise index={4}>
        <RtcCredentialPaths tenantId={tenantId} />
      </Rise>
    </Page>
  );
}

/* ------------------------- Apuração da Receita: os dois caminhos possíveis */

/** Passo a passo vem do banco (notices_for), nunca do código. */
function PathSteps({ notice }: { notice: Notice | undefined }) {
  if (!notice) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        O passo a passo deste caminho ainda não foi publicado pela plataforma.
      </p>
    );
  }
  return (
    <>
      <p className="mt-2 text-sm font-medium">{notice.title}</p>
      <NoticeBody body={notice.body} className="mt-2" />
    </>
  );
}

function CredentialStateBadge({ state }: { state: RtcCredentialState | undefined }) {
  if (!state) return <Skeleton className="h-5 w-24" />;
  if (!state.configurada) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        não configurada
      </Badge>
    );
  }
  return <Badge className="bg-flow-in/15 text-flow-in">ativa</Badge>;
}

function RtcCredentialPaths({ tenantId }: { tenantId: string }) {
  const state = useRtcCredentialState(tenantId);
  const notices = useNotices("integracoes_rtc");
  const identity = usePlatformIdentity();
  const upload = useUploadCredential(tenantId);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [copied, setCopied] = useState(false);

  const noticeProprio = notices.data?.find((n) => n.key === "rtc_credencial_proprio");
  const noticeProcurador = notices.data?.find((n) => n.key === "rtc_credencial_procurador");

  const caminho = state.data?.caminho ?? null;
  const cnpj = identity.data?.cnpj ?? "";
  const cnpjPendente = cnpj.startsWith("(");

  return (
    <Panel
      title="Apuração assistida de CBS (Plataforma RTC)"
      icon={KeyRound}
      help={
        <p>
          {state.data?.mensagem ??
            "Existem dois caminhos para conectar a sua apuração da Receita. Ambos funcionam igual para você aqui dentro — escolha o que preferir."}
        </p>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <CredentialStateBadge state={state.data} />
          {caminho && (
            <Badge variant="outline" className="text-[10px] uppercase">
              caminho: {caminho === "proprio" ? "credencial própria" : "procurador"}
            </Badge>
          )}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {/* caminho 1 — o cliente gera a credencial */}
        <Panel
          title="Credencial própria"
          icon={KeyRound}
          interactive={false}
          help={
            <p>
              O ClientSecret é cifrado no envio, nunca é exibido de novo e não pode ser baixado. Você
              pode revogá-lo no portal da Receita ou aqui, quando quiser.
            </p>
          }
          actions={
            caminho === "proprio" ? (
              <Badge className="bg-flow-in/15 text-flow-in text-[10px]">em uso</Badge>
            ) : undefined
          }
        >
          <PathSteps notice={noticeProprio} />

          <a
            href={identity.data?.portal_rtc ?? "https://consumo.tributos.gov.br"}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Abrir o portal da Receita <ExternalLink className="size-3" aria-hidden />
          </a>

          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rtc-client-id">ClientId</Label>
              <Input
                id="rtc-client-id"
                autoComplete="off"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="identificador gerado no portal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rtc-client-secret">ClientSecret</Label>
              <Input
                id="rtc-client-secret"
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="cole o segredo gerado no portal"
              />
            </div>
          </div>

          <Button
            className="mt-4"
            variant="outline"
            disabled={clientId.trim().length < 4 || clientSecret.trim().length < 8 || upload.isPending}
            onClick={async () => {
              try {
                await upload.mutateAsync({
                  kind: "api_key",
                  provider: "rtc_cbs",
                  apiKey: `${clientId.trim()}:${clientSecret.trim()}`,
                });
                setClientId("");
                setClientSecret("");
                void state.refetch();
                toast.success("Credencial da Plataforma RTC registrada e cifrada.");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao registrar.");
              }
            }}
          >
            {upload.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Salvar credencial
          </Button>
        </Panel>

        {/* caminho 2 — nos autoriza como procurador */}
        <Panel
          title="Nos autorizar como procurador"
          icon={FileCheck2}
          interactive={false}
          help={
            <p>
              A autorização é sua: você pode cancelá-la a qualquer momento no e-CAC, e revogar aqui
              também. Nesse caminho usamos o nosso certificado — não guardamos chave privada sua.
            </p>
          }
          actions={
            caminho === "procurador" ? (
              <Badge className="bg-flow-in/15 text-flow-in text-[10px]">em uso</Badge>
            ) : undefined
          }
        >
          <PathSteps notice={noticeProcurador} />

          <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Confira os dois antes de autorizar no e-CAC
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{identity.isLoading ? "…" : cnpj}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={cnpjPendente || identity.isLoading}
                onClick={async () => {
                  await navigator.clipboard.writeText(cnpj);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  toast.success("CNPJ copiado.");
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
            {identity.data?.razao_social && !identity.data.razao_social.startsWith("(") && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Razão social:{" "}
                  <span className="text-foreground">{identity.data.razao_social}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(identity.data!.razao_social);
                    toast.success("Razão social copiada.");
                  }}
                >
                  <Copy className="mr-1 size-3.5" aria-hidden />
                  Copiar
                </Button>
              </div>
            )}
            {cnpjPendente && (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-400">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                CNPJ ainda não publicado pela plataforma — fale com o administrador antes de autorizar.
              </p>
            )}
          </div>

          <a
            href={
              identity.data?.ecac_controle_acesso ??
              "https://www.gov.br/receitafederal/pt-br/assuntos/meu-cnpj/controle-de-acesso"
            }
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Abrir Controle de Acesso da Receita <ExternalLink className="size-3" aria-hidden />
          </a>

          <Button
            className="mt-4"
            variant="outline"
            disabled={upload.isPending || cnpjPendente}
            onClick={async () => {
              try {
                await upload.mutateAsync({ kind: "procuracao", provider: "rtc_cbs" });
                void state.refetch();
                toast.success("Registramos a autorização. Vamos validar e gerar a credencial.");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao registrar.");
              }
            }}
          >
            {upload.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Já autorizei
          </Button>
        </Panel>
      </div>

      {state.data?.ultimo_erro && (
        <p className="mt-4 text-xs text-flow-out">Última tentativa falhou: {state.data.ultimo_erro}</p>
      )}
      {state.data?.ultimo_uso && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Último uso: {new Date(state.data.ultimo_uso).toLocaleString("pt-BR")}
        </p>
      )}
    </Panel>
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
  onOpenUsage,
}: {
  tenantId: string;
  query: ReturnType<typeof useCredentials>;
  onOpenUsage?: () => void;
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
    <Panel
      title="Credenciais registradas"
      icon={ShieldCheck}
      actions={
        hasActiveDfe(rows) ? (
          <Badge className="bg-flow-in/15 text-flow-in">leitura de notas autorizada</Badge>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Nenhuma credencial registrada"
            hint="Comece pela procuração eletrônica, abaixo."
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => {
            const semaphore = credentialSemaphore(row);
            // O certificado é o caminho principal: ganha cartão próprio, com
            // validade em destaque, titular tratado e prova de verificação.
            if (row.kind === "certificado_a1") {
              return (
                <li key={row.id}>
                  <CertificateStatusCard
                    row={row}
                    onOpenUsage={onOpenUsage}
                    onReplace={() =>
                      document
                        .getElementById("cert-upload")
                        ?.scrollIntoView({ behavior: "smooth", block: "center" })
                    }
                    onRevoke={() => {
                      setReason("");
                      setPending(row);
                    }}
                    onRetry={() => void query.refetch()}
                  />
                </li>
              );
            }
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

                {/* Quem subiu, quando — e se subiu em nome da empresa.
                    Transparência protege o cliente e protege quem operou. */}
                {row.uploaded_on_behalf && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Enviada por{" "}
                    <span className="text-foreground">
                      {row.uploaded_by_name ?? "usuário do canal/plataforma"}
                    </span>
                    {row.uploaded_by_role ? ` (${row.uploaded_by_role})` : ""}
                    {row.created_at
                      ? ` em ${new Date(row.created_at).toLocaleString("pt-BR")}`
                      : ""}{" "}
                    — não é membro direto desta empresa.
                  </p>
                )}

                {(row.finalidades?.length ?? 0) > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Autorizada para:{" "}
                    {row.finalidades!
                      .map((f) => FINALIDADE_LABEL[f] ?? f)
                      .join("; ")}
                    .
                  </p>
                )}

                {(row.falhas_consecutivas ?? 0) > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
                    <div>
                      <p className="font-medium">
                        {row.falhas_consecutivas} falha
                        {row.falhas_consecutivas === 1 ? "" : "s"} consecutiva
                        {row.falhas_consecutivas === 1 ? "" : "s"}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        Falhas isoladas costumam ser instabilidade da Receita e não param nada. Após
                        3 falhas seguidas, pausamos a ingestão e avisamos. O contador zera no
                        primeiro sucesso.
                      </p>
                    </div>
                  </div>
                )}

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
              A credencial deixa de valer imediatamente e o material cifrado é descartado — não há
              como desfazer. A ingestão dos seus documentos fiscais por esse caminho <strong>para</strong>{" "}
              até você registrar outra credencial.
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
    </Panel>
  );
}

/* ------------------------------------------------------ (a) procuração */

function ProcuracaoCard({ tenantId }: { tenantId: string }) {
  const upload = useUploadCredential(tenantId);
  const cnpj = PROCURADOR_CNPJ ?? null;

  return (
    <Panel
      title="Procuração eletrônica"
      icon={FileCheck2}
      className="border-primary/40 ring-1 ring-primary/20"
      help={
        <p>
          Você nos nomeia procurador no e-CAC e nós usamos o nosso próprio certificado. Nenhuma
          chave privada sua fica com o TECH-IVA.
        </p>
      }
      actions={<Badge className="bg-primary/15 text-primary">recomendado</Badge>}
    >
      <ol className="space-y-2 text-xs text-muted-foreground">
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
    </Panel>
  );
}

/* --------------------------------------------------------- (b) api key */

function ApiKeyCard({ tenantId }: { tenantId: string }) {
  const upload = useUploadCredential(tenantId);
  const [value, setValue] = useState("");

  return (
    <Panel
      title="Chave de API (Portal RTC)"
      icon={KeyRound}
      help={
        <p>
          Gere a chave no Portal RTC e cole aqui. Você pode revogá-la lá e aqui, quando quiser. A
          chave é cifrada no envio e nunca é exibida de novo.
        </p>
      }
    >
      <div className="space-y-2">
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
    </Panel>
  );
}

/* ----------------------------------------------------- (c) certificado */

function CertificateCard({ tenantId }: { tenantId: string }) {
  const upload = useUploadCredential(tenantId);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);

  return (
    <div id="cert-upload" className="scroll-mt-24">
    <Panel
      title="Certificado A1 (.pfx)"
      icon={ShieldCheck}
      help={
        <>
          <p>
            Um certificado A1 é uma <strong>chave privada</strong> que assina em nome da sua
            empresa. O arquivo é cifrado no envio, guardado em área privada e{" "}
            <strong>nunca pode ser baixado de volta</strong> — nem por nós. A senha também é
            cifrada e não é exibida novamente.
          </p>
          <p>
            Nada além das finalidades listadas abaixo. Cada uso fica registrado e você consulta na
            aba “Onde foi usado”.
          </p>
          <p>
            Validamos abrindo o arquivo com a senha e conferindo se o titular é o CNPJ desta
            empresa. Se não bater, recusamos e nada é guardado.
          </p>
        </>
      }
    >
      {/* O cliente autoriza usos ESPECÍFICOS, não acesso genérico. */}
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
        <p className="text-xs font-medium">Para que vamos usar este certificado</p>
        <ul className="mt-2 space-y-1.5">
          {FINALIDADES_PADRAO.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-flow-in" aria-hidden />
              <span>{FINALIDADE_LABEL[f]}</span>
            </li>
          ))}
        </ul>
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
          <span>
            Autorizo o uso do certificado desta empresa para as finalidades listadas acima.
          </span>
        </label>
        <Button
          className="w-full"
          disabled={!file || password.length === 0 || !ack || upload.isPending}
          onClick={async () => {
            if (!file) return;
            try {
              const result = await upload.mutateAsync({
                kind: "certificado_a1",
                file,
                password,
                finalidades: FINALIDADES_PADRAO,
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
    </Panel>
    </div>
  );
}

/* ------------------------------ onde o certificado foi usado (extrato) */

function UsageTab({ tenantId }: { tenantId: string }) {
  const usage = useCredentialUsage(tenantId, 90);

  if (usage.isLoading) return <Skeleton className="h-28 w-full" />;
  if (usage.isError) {
    return <ErrorState message={usage.error instanceof Error ? usage.error.message : "Falha."} />;
  }

  const rows = usage.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nenhum uso registrado ainda"
        hint="Assim que usarmos a sua credencial, cada operação aparece aqui com data, finalidade e resultado."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 pr-4 font-medium">Data</th>
            <th className="py-2 pr-4 font-medium">Finalidade</th>
            <th className="py-2 pr-4 font-medium">Resultado</th>
            <th className="py-2 font-medium">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.usado_em}-${i}`} className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-[11px]">
                {new Date(row.usado_em).toLocaleString("pt-BR")}
              </td>
              <td className="py-2 pr-4">{FINALIDADE_LABEL[row.finalidade] ?? row.finalidade}</td>
              <td className="py-2 pr-4">
                {row.sucesso ? (
                  <span className="text-flow-in">sucesso</span>
                ) : (
                  <span className="text-flow-out">falha</span>
                )}
              </td>
              <td className="py-2 text-muted-foreground">{row.detalhe ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
