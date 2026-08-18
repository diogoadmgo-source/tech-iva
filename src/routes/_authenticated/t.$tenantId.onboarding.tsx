import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, FileCheck2, Landmark, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { JobProgress } from "@/components/techiva/job-progress";
import { Stepper } from "@/components/techiva/stepper";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { hasActiveDfe, useCredentials, useUploadCredential } from "@/lib/credentials";
import { useJobs, useEnqueueJob, type JobKind } from "@/lib/jobs";
import {
  isValidCnpj,
  REGIME_OPTIONS,
  useOnboarding,
  useOnboardingMutations,
  type OnboardingCompanyData,
  type RegimeDeclarado,
} from "@/lib/onboarding";
import {
  CnpjAutofillField,
  FromRegistryHint,
  formatCnpj,
} from "@/components/techiva/cnpj-autofill";
import { PRESUMIDO_DISCLAIMER, type CnpjRecord } from "@/lib/cnpj";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/onboarding")({
  head: () => ({
    meta: [
      { title: "Onboarding da empresa — TECH-IVA" },
      {
        name: "description",
        content:
          "Configure a empresa, autorize a leitura das notas fiscais e conecte o banco para começar a projetar o caixa do imposto.",
      },
      { property: "og:title", content: "Onboarding da empresa — TECH-IVA" },
      {
        property: "og:description",
        content: "Quatro passos para o TECH-IVA ler a sua operação e projetar o caixa do imposto.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OnboardingPage,
});

const STEPS = ["Empresa", "Autorizar notas", "Conectar banco", "Lendo sua operação"];
const READ_CHAIN: JobKind[] = ["ingest_dfe", "classify_chain", "compute_taxes", "project_cash"];

function OnboardingPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const { data, isLoading, isError, refetch } = useOnboarding(tenantId);
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (data && step === null) setStep(data.suggestedStep);
  }, [data, step]);

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState message="Falha ao ler o estado do onboarding." onRetry={() => void refetch()} />;
  }
  if (data.tenant.kind !== "company" && data.tenant.kind !== "unit") {
    return (
      <EmptyState
        icon={Building2}
        title="Onboarding é só para empresas"
        hint="Selecione uma empresa na árvore de organizações para configurar a leitura da operação."
      />
    );
  }

  const current = step ?? data.suggestedStep;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Onboarding</p>
        <h1 className="text-2xl font-semibold">{shell.data?.tenant.name ?? data.tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Quatro passos para o TECH-IVA ler sua operação e mostrar o caixa do imposto.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
        <h2 className="text-sm font-semibold">Use agora, antes de conectar as notas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cálculo pelo motor oficial da Receita Federal, com memória de cálculo e base legal. Seus
          dados não saem da nossa infraestrutura.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/t/$tenantId/simulador" params={{ tenantId }}>
              Simulador de CBS, IBS e IS
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/t/$tenantId/validador" params={{ tenantId }}>
              Validador de XML
            </Link>
          </Button>
        </div>
      </section>

      <Stepper steps={STEPS} current={current} />

      {current === 0 && <StepCompany tenantId={tenantId} onNext={() => setStep(1)} />}
      {current === 1 && (
        <StepDfe tenantId={tenantId} onBack={() => setStep(0)} onNext={() => setStep(2)} />
      )}
      {current === 2 && (
        <StepBank tenantId={tenantId} onBack={() => setStep(1)} onNext={() => setStep(3)} />
      )}
      {current === 3 && <StepReading tenantId={tenantId} onBack={() => setStep(2)} />}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface-1 p-5 shadow-[var(--shadow-1)]">
      {children}
    </section>
  );
}

/** Regimes que o cadastro público consegue derivar → opção do seletor. */
const REGISTRY_TO_DECLARED: Partial<Record<string, RegimeDeclarado>> = {
  mei: "mei",
  simples: "simples",
  presumido: "presumido",
  real: "real",
};

function StepCompany({ tenantId, onNext }: { tenantId: string; onNext: () => void }) {
  const { data } = useOnboarding(tenantId);
  const { saveSettings, saveTenantData } = useOnboardingMutations(tenantId);
  const [cnpj, setCnpj] = useState(formatCnpj(data?.tenant.cnpj ?? ""));
  const [regime, setRegime] = useState<RegimeDeclarado | "">(data?.settings.regime_declared ?? "");
  const [accountant, setAccountant] = useState(data?.settings.accountant_email ?? "");
  const [company, setCompany] = useState<OnboardingCompanyData>(
    data?.settings.company ?? { razao_social: data?.tenant.name ?? "" },
  );
  const [fromRegistry, setFromRegistry] = useState(false);
  const digits = cnpj.replace(/\D/g, "");
  const cnpjOk = digits.length === 0 || isValidCnpj(digits);

  const set = (patch: Partial<OnboardingCompanyData>) =>
    setCompany((current) => ({ ...current, ...patch }));

  function applyRecord(record: CnpjRecord) {
    setFromRegistry(true);
    set({
      razao_social: record.razao_social ?? null,
      nome_fantasia: record.nome_fantasia ?? null,
      logradouro: record.logradouro ?? null,
      numero: record.numero ?? null,
      bairro: record.bairro ?? null,
      municipio: record.municipio ?? null,
      uf: record.uf ?? null,
      cep: record.cep ?? null,
      cnae: record.cnae_principal
        ? `${record.cnae_principal}${record.cnae_principal_desc ? ` — ${record.cnae_principal_desc}` : ""}`
        : null,
      porte: record.porte ?? null,
      situacao: record.situacao ?? null,
      registry_fetched_at: record.fetched_at ?? new Date().toISOString(),
    });
    const derived = REGISTRY_TO_DECLARED[record.regime ?? ""];
    if (derived) setRegime(derived);
  }

  async function submit() {
    if (!regime) {
      toast.error("Escolha o regime declarado.");
      return;
    }
    if (!cnpjOk) {
      toast.error("CNPJ inválido.");
      return;
    }
    try {
      const name = (company.razao_social ?? "").trim();
      await saveTenantData.mutateAsync({
        ...(digits && digits !== (data?.tenant.cnpj ?? "") ? { cnpj: digits } : {}),
        ...(name && name !== data?.tenant.name ? { name } : {}),
      });
      await saveSettings.mutateAsync({
        regime_declared: regime,
        accountant_email: accountant.trim() || null,
        company,
        step: 1,
      });
      onNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    }
  }

  return (
    <Card>
      <h2 className="text-base font-medium">Empresa</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Digite o CNPJ: buscamos o cadastro público da Receita e preenchemos o resto. Todos os campos
        continuam editáveis. O regime orienta o cálculo e a simulação tradicional × híbrido.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <CnpjAutofillField id="ob-cnpj" value={cnpj} onChange={setCnpj} onResolved={applyRecord} />

        <div className="space-y-1.5">
          <Label htmlFor="ob-regime">Regime declarado</Label>
          <Select value={regime} onValueChange={(v) => setRegime(v as RegimeDeclarado)}>
            <SelectTrigger id="ob-regime">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {REGIME_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fromRegistry && <p className="text-[11px] text-muted-foreground">{PRESUMIDO_DISCLAIMER}</p>}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-razao">Razão social</Label>
          <Input
            id="ob-razao"
            value={company.razao_social ?? ""}
            onChange={(e) => set({ razao_social: e.target.value })}
          />
          {fromRegistry && <FromRegistryHint />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-fantasia">Nome fantasia</Label>
          <Input
            id="ob-fantasia"
            value={company.nome_fantasia ?? ""}
            onChange={(e) => set({ nome_fantasia: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-porte">Porte</Label>
          <Input
            id="ob-porte"
            value={company.porte ?? ""}
            onChange={(e) => set({ porte: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-cnae">CNAE principal</Label>
          <Input
            id="ob-cnae"
            value={company.cnae ?? ""}
            onChange={(e) => set({ cnae: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-logradouro">Endereço</Label>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Input
              id="ob-logradouro"
              value={company.logradouro ?? ""}
              onChange={(e) => set({ logradouro: e.target.value })}
              placeholder="Logradouro"
            />
            <Input
              value={company.numero ?? ""}
              onChange={(e) => set({ numero: e.target.value })}
              placeholder="Nº"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-bairro">Bairro</Label>
          <Input
            id="ob-bairro"
            value={company.bairro ?? ""}
            onChange={(e) => set({ bairro: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-cep">CEP</Label>
          <Input
            id="ob-cep"
            value={company.cep ?? ""}
            onChange={(e) => set({ cep: e.target.value })}
            className="font-mono tabular"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-municipio">Município</Label>
          <Input
            id="ob-municipio"
            value={company.municipio ?? ""}
            onChange={(e) => set({ municipio: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-uf">UF</Label>
          <Input
            id="ob-uf"
            value={company.uf ?? ""}
            onChange={(e) => set({ uf: e.target.value.toUpperCase().slice(0, 2) })}
            className="uppercase"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-accountant">E-mail do contador (opcional)</Label>
          <Input
            id="ob-accountant"
            type="email"
            value={accountant}
            onChange={(e) => setAccountant(e.target.value)}
            placeholder="contador@escritorio.com.br"
          />
          <p className="text-xs text-muted-foreground">
            Guardamos aqui; convide como <span className="font-medium">viewer</span> na tela de
            usuários quando quiser dar acesso.
          </p>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={() => void submit()} disabled={saveSettings.isPending}>
          Continuar
        </Button>
      </div>
    </Card>
  );
}

function StepDfe({
  tenantId,
  onBack,
  onNext,
}: {
  tenantId: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const credentials = useCredentials(tenantId);
  const upload = useUploadCredential(tenantId);
  const { setIntegration } = useOnboardingMutations(tenantId);
  const done = hasActiveDfe(credentials.data);

  const [apiKey, setApiKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);

  async function register(input: Parameters<typeof upload.mutateAsync>[0], message: string) {
    try {
      await upload.mutateAsync(input);
      await setIntegration.mutateAsync({
        kind: "dfe_auth",
        status: "connected",
        config: { method: input.kind, requested_at: new Date().toISOString() },
      });
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar.");
    }
  }

  return (
    <Card>
      <h2 className="text-base font-medium">Autorizar a leitura das notas</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Precisamos de autorização para baixar seus documentos fiscais. Recomendamos a procuração
        eletrônica: nela usamos o <strong>nosso</strong> certificado, então não guardamos chave
        privada de cliente nenhum. Dizemos isso na cara: é escolha de confiança, não limitação.
      </p>

      {done && (
        <p className="mt-3 rounded-lg border border-flow-in/30 bg-flow-in/10 px-3 py-2 text-xs">
          Leitura de notas autorizada. Este passo está concluído.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {/* (a) procuração — recomendado */}
        <div className="rounded-lg border border-primary/40 bg-surface-2 p-4 ring-1 ring-primary/20">
          <div className="flex items-center gap-2">
            <FileCheck2 className="size-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Procuração eletrônica</p>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
              recomendado
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            No e-CAC, em “Senhas e Procurações”, nomeie o TECH-IVA como procurador nos serviços de
            consulta de documentos fiscais. O passo a passo completo, com o CNPJ para copiar, está
            em Integrações.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={upload.isPending}
              onClick={() => void register({ kind: "procuracao" }, "Procuração registrada.")}
            >
              {upload.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Já autorizei
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/t/$tenantId/settings/integrations" params={{ tenantId }}>
                Ver passo a passo
              </Link>
            </Button>
          </div>
        </div>

        {/* (b) chave de API */}
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Chave de API do Portal RTC</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Gere a chave no portal e cole aqui. Ela é cifrada no envio, não volta para a tela e você
            pode revogá-la a qualquer momento.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="onb-api-key" className="text-xs">
                Chave
              </Label>
              <Input
                id="onb-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={apiKey.trim().length < 8 || upload.isPending}
              onClick={() =>
                void register(
                  { kind: "api_key", apiKey: apiKey.trim() },
                  "Chave registrada e cifrada.",
                ).then(() => setApiKey(""))
              }
            >
              Registrar chave
            </Button>
          </div>
        </div>

        {/* (c) certificado A1 — último recurso */}
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Certificado A1 (.pfx)</p>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              último recurso
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            É uma chave privada que assina em nome da sua empresa. Validamos o titular, ciframos e
            guardamos fora do banco — e não existe caminho para baixá-la de volta.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="onb-pfx" className="text-xs">
                Arquivo
              </Label>
              <Input
                id="onb-pfx"
                type="file"
                accept=".pfx,.p12"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="onb-pfx-pass" className="text-xs">
                Senha
              </Label>
              <Input
                id="onb-pfx-pass"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
            <span>Entendo que estou enviando um certificado digital da minha empresa.</span>
          </label>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={!file || password.length === 0 || !ack || upload.isPending}
            onClick={() => {
              if (!file) return;
              void register(
                { kind: "certificado_a1", file, password },
                "Certificado validado e cifrado.",
              ).then(() => {
                setFile(null);
                setPassword("");
                setAck(false);
              });
            }}
          >
            Enviar certificado
          </Button>
        </div>
      </div>

      <div className="mt-5 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        <Button variant={done ? "default" : "outline"} onClick={onNext}>
          {done ? "Continuar" : "Pular por enquanto"}
        </Button>
      </div>
    </Card>
  );
}

function StepBank({
  tenantId,
  onBack,
  onNext,
}: {
  tenantId: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const { data } = useOnboarding(tenantId);
  const { setIntegration, saveSettings } = useOnboardingMutations(tenantId);
  const bank = data?.integrations.find((i) => i.kind === "open_finance");

  return (
    <Card>
      <h2 className="text-base font-medium">Conectar banco (opcional)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Com o extrato conectado, a projeção usa a data real de recebimento — a confiança do caixa
        sobe de estimada para observada.
      </p>
      <div className="mt-4 rounded-lg border border-border bg-surface-2 p-4">
        <Landmark className="size-4 text-primary" aria-hidden />
        <p className="mt-2 text-sm font-medium">Open Finance</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Você autoriza o compartilhamento no seu banco e volta para cá. Somos somente leitura.
        </p>
        {bank?.status === "connected" ? (
          <p className="mt-3 text-xs text-in">Banco conectado.</p>
        ) : (
          <Button
            size="sm"
            className="mt-3"
            disabled={setIntegration.isPending}
            onClick={async () => {
              try {
                await setIntegration.mutateAsync({
                  kind: "open_finance",
                  status: "pending",
                  config: { requested_at: new Date().toISOString() },
                });
                toast.info("Consentimento iniciado. Conclua no seu banco para liberar o extrato.");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao iniciar.");
              }
            }}
          >
            Iniciar consentimento
          </Button>
        )}
      </div>
      <div className="mt-5 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await saveSettings.mutateAsync({ bank_skipped: true, step: 3 });
              onNext();
            }}
          >
            Pular por enquanto
          </Button>
          <Button onClick={onNext}>Continuar</Button>
        </div>
      </div>
    </Card>
  );
}

function StepReading({ tenantId, onBack }: { tenantId: string; onBack: () => void }) {
  const { data: jobs } = useJobs(tenantId, 30);
  const enqueue = useEnqueueJob(tenantId);
  const { saveSettings } = useOnboardingMutations(tenantId);
  const { data: state } = useOnboarding(tenantId);

  const chain = useMemo(() => {
    return READ_CHAIN.map((kind) => (jobs ?? []).find((j) => j.kind === kind)).filter(
      (j): j is NonNullable<typeof j> => Boolean(j),
    );
  }, [jobs]);

  const allDone = chain.length === READ_CHAIN.length && chain.every((j) => j.status === "done");
  const running = chain.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (allDone && state && !state.settings.completed_at) {
      void saveSettings.mutateAsync({ completed_at: new Date().toISOString(), step: 4 });
    }
  }, [allDone, state, saveSettings]);

  return (
    <Card>
      <h2 className="text-base font-medium">Lendo sua operação</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Importamos os documentos, classificamos a cadeia, calculamos IBS/CBS e projetamos o caixa.
      </p>

      {chain.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Nenhuma leitura iniciada"
            hint="Enfileire a leitura da operação para gerar a primeira projeção."
            action={
              <Button
                disabled={enqueue.isPending}
                onClick={async () => {
                  try {
                    for (const kind of READ_CHAIN) {
                      await enqueue.mutateAsync({ kind, params: { source: "onboarding" } });
                    }
                    toast.success("Leitura enfileirada.");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Falha ao enfileirar.");
                  }
                }}
              >
                {enqueue.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
                Ler minha operação
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {chain.map((job) => (
            <JobProgress key={job.id} job={job} />
          ))}
        </div>
      )}

      {allDone && (
        <div className="mt-4 rounded-lg border border-in/30 bg-in/10 p-4">
          <p className="text-sm font-medium">Sua operação foi lida.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A projeção do caixa do imposto já está disponível, com clientes e fornecedores
            classificados por regime.
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link to="/t/$tenantId/cash" params={{ tenantId }}>
              Ver meu caixa
            </Link>
          </Button>
        </div>
      )}

      <div className="mt-5 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        {running && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Atualizando em tempo real
          </span>
        )}
      </div>
    </Card>
  );
}
