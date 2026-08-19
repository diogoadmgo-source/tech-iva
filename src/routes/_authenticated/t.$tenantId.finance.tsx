import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  FileText,
  Landmark,
  Loader2,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { FormError } from "@/components/auth/auth-shell";
import { EmptyState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { Page, PageHeader, Panel, Rise, Segmented } from "@/components/techiva/page";
import { formatCents, formatPct, MoneyText } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Stepper } from "@/components/techiva/stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDashboardCash } from "@/lib/cash";
import {
  LEDGER_COPY,
  OFFER_COPY,
  isMfaRequired,
  useAcceptOffer,
  useCanCredit,
  useContractDetail,
  useCreditContracts,
  useCreditOffers,
  useGenerateOffers,
  useOfferDetail,
  type CreditOffer,
  type OfferKind,
} from "@/lib/finance";
import { useShellData } from "@/lib/tenant-shell-data";
import { useFeature } from "@/lib/features";
import { EmptyState as FeatureEmptyState } from "@/components/techiva/empty-state";

export const Route = createFileRoute("/_authenticated/t/$tenantId/finance")({
  head: () => ({
    meta: [
      { title: "Financiamento do imposto · TECH-IVA" },
      {
        name: "description",
        content:
          "Ofertas de antecipação de crédito, linha para descasamento de caixa e contratos ativos com impacto no caixa do imposto.",
      },
      { property: "og:title", content: "Financiamento do imposto · TECH-IVA" },
      {
        property: "og:description",
        content: "Contrate crédito com assinatura e MFA e acompanhe o repagamento no caixa do imposto.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancePage,
});

const OFFER_ICON: Record<OfferKind, typeof Banknote> = {
  credit_advance: Banknote,
  gap_line: Landmark,
  provision_account: PiggyBank,
};

function FinancePage() {
  const { tenantId } = Route.useParams();
  const navigate = useNavigate();
  const creditFeature = useFeature(tenantId, "credit");

  // Módulo desligado: nada de erro cru — mensagem clara e volta para o Caixa.
  useEffect(() => {
    if (creditFeature.data === false) {
      const timer = setTimeout(() => {
        void navigate({ to: "/t/$tenantId/cash", params: { tenantId }, replace: true });
      }, 2500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [creditFeature.data, navigate, tenantId]);

  if (creditFeature.data === false) {
    return (
      <Page className="max-w-2xl py-10">
        <FeatureEmptyState
          title="Módulo não habilitado"
          hint="O módulo de crédito não está habilitado para esta empresa — fale com o administrador da plataforma. Levando você de volta ao Caixa do imposto."
        />
      </Page>
    );
  }

  return <FinanceModule tenantId={tenantId} />;
}

function FinanceModule({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const shell = useShellData(tenantId);
  const cash = useDashboardCash(tenantId, 90);
  const canCredit = useCanCredit(tenantId);
  const offers = useCreditOffers(tenantId);
  const contracts = useCreditContracts(tenantId);
  const generate = useGenerateOffers(tenantId);
  const accept = useAcceptOffer(tenantId);

  const [offerId, setOfferId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [tab, setTab] = useState<"offers" | "contracts">("offers");

  const detail = useOfferDetail(offerId);
  const contract = useContractDetail(contractId);

  const hero = cash.data?.hero;
  const kpis = cash.data?.kpis;

  function openOffer(offer: CreditOffer) {
    setOfferId(offer.id);
    setStep(0);
    setSignature("");
    setError(null);
  }

  async function contractOffer() {
    if (!offerId) return;
    setError(null);
    if (signature.trim().length < 4) {
      setError("Escreva seu nome completo para assinar.");
      return;
    }
    try {
      const id = await accept.mutateAsync({ offerId, signature: signature.trim() });
      setOfferId(null);
      setContractId(id);
      toast.success("Contrato assinado. O impacto já aparece no Caixa do imposto.");
    } catch (err) {
      if (isMfaRequired(err)) {
        setError("Contratação exige MFA. Vamos abrir a verificação em dois fatores.");
        toast.error("MFA obrigatório para contratar.");
        void navigate({ to: "/mfa" });
        return;
      }
      setError(err instanceof Error ? err.message : "Falha ao contratar.");
    }
  }

  const readOnly = canCredit.data === false;

  return (
    <Page>
      <PageHeader
        eyebrow="caixa · financiamento"
        title="Financiamento"
        help={
          <>
            <p>
              Crédito para o caixa do imposto de{" "}
              <strong>{shell.data?.tenant.name ?? "…"}</strong> — cada oferta mostra o impacto na
              sua projeção de 30 e 90 dias.
            </p>
            {readOnly ? <p>Somente owner e financeiro podem contratar crédito. Você está em modo leitura.</p> : null}
          </>
        }
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const count = await generate.mutateAsync();
                toast.success(
                  count > 0 ? `${count} oferta(s) atualizada(s).` : "Nenhuma oferta elegível agora.",
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Falha ao recalcular.");
              }
            }}
            disabled={generate.isPending || readOnly}
          >
            {generate.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Recalcular ofertas
          </Button>
        }
      />

      <Rise index={1} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Buraco em 30 dias"
          valueCents={hero?.gap_30_cents ?? 0}
          loading={cash.isLoading}
        />
        <KpiCard
          label="Buraco em 90 dias"
          valueCents={hero?.gap_90_cents ?? 0}
          loading={cash.isLoading}
        />
        <KpiCard
          label="Crédito a aproveitar"
          valueCents={kpis?.credit_backlog_cents ?? 0}
          hint={kpis ? `média de ${kpis.credit_avg_days} dias` : undefined}
          loading={cash.isLoading}
        />
        <KpiCard
          label="Contratos ativos"
          value={String((contracts.data ?? []).filter((c) => c.status === "active").length)}
          loading={contracts.isLoading}
        />
      </Rise>

      <Rise index={2}>
        <div className="flex items-center justify-between gap-3">
          <Segmented
            label="Seção"
            value={tab}
            onChange={(v) => setTab(v)}
            options={[
              { value: "offers", label: "Ofertas" },
              { value: "contracts", label: "Contratos" },
            ]}
          />
        </div>
      </Rise>

      {tab === "offers" ? (
        <Rise index={3}>
          {offers.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-52 w-full" />
              <Skeleton className="h-52 w-full" />
              <Skeleton className="h-52 w-full" />
            </div>
          ) : (offers.data ?? []).length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="Nenhuma oferta disponível"
              hint="As ofertas são geradas a partir do crédito acumulado e do próximo descasamento do caixa. Recalcule para verificar sua elegibilidade."
              action={
                <Button variant="outline" onClick={() => void generate.mutateAsync()} disabled={readOnly}>
                  Recalcular ofertas
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(offers.data ?? []).map((offer) => {
                const Icon = OFFER_ICON[offer.kind];
                const copy = OFFER_COPY[offer.kind];
                return (
                  <article
                    key={offer.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4 shadow-e1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <Badge variant="secondary">{offer.term_months} meses</Badge>
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold">{copy.title}</h2>
                      <p className="text-xs text-muted-foreground">{copy.description}</p>
                    </div>
                    <p className="text-2xl font-semibold">
                      <MoneyText cents={offer.net_amount_cents} />
                    </p>
                    <dl className="space-y-1.5 text-xs">
                      <Row
                        label={offer.kind === "credit_advance" ? "Deságio" : "Taxa mensal"}
                        value={formatPct(
                          offer.kind === "credit_advance" ? offer.discount_pct : offer.monthly_rate_pct,
                          2,
                        )}
                      />
                      <Row label="Custo total" value={formatCents(offer.total_cost_cents)} />
                      <Row label="CET do período" value={formatPct(offer.cet_pct, 2)} />
                      {offer.reference_date ? (
                        <Row
                          label={offer.kind === "gap_line" ? "Semana coberta" : "Referência"}
                          value={new Date(`${offer.reference_date}T00:00:00`).toLocaleDateString("pt-BR")}
                        />
                      ) : null}
                    </dl>
                    <Button className="mt-auto" onClick={() => openOffer(offer)}>
                      Ver detalhes <ArrowRight className="ml-2 size-4" />
                    </Button>
                  </article>
                );
              })}
            </div>
          )}
        </Rise>
      ) : (
        <Rise index={3}>
          {contracts.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (contracts.data ?? []).length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum contrato"
              hint="Contratos assinados aparecem aqui com timeline de repagamento e extrato."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Liberado</TableHead>
                    <TableHead>Total devido</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Próx. vencimento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(contracts.data ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm">{OFFER_COPY[c.kind]?.title ?? c.kind}</TableCell>
                      <TableCell>
                        <MoneyText cents={c.net_disbursed_cents} className="text-xs" />
                      </TableCell>
                      <TableCell>
                        <MoneyText cents={c.total_due_cents} className="text-xs" />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.term_months} m</TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.next_due
                          ? new Date(`${c.next_due}T00:00:00`).toLocaleDateString("pt-BR")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.status === "active" ? "secondary" : "outline"}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setContractId(c.id)}>
                          Detalhes
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Rise>
      )}

      {/* drawer da oferta: revisar → assinar */}
      <SideSheet
        open={Boolean(offerId)}
        onOpenChange={(open) => {
          if (!open) setOfferId(null);
        }}
        title="Contratar crédito"
        description="Revise o custo e o impacto no caixa antes de assinar."
        footer={
          <div className="flex items-center justify-between gap-3">
            {step === 0 ? (
              <>
                <span className="text-xs text-muted-foreground">
                  <ShieldCheck className="mr-1 inline size-3.5" />
                  Assinatura exige MFA
                </span>
                <Button onClick={() => setStep(1)} disabled={readOnly || !detail.data}>
                  Continuar
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Voltar
                </Button>
                <Button onClick={() => void contractOffer()} disabled={accept.isPending}>
                  {accept.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Assinar e contratar
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          <Stepper steps={["Revisar", "Assinar"]} current={step} />
          {detail.isLoading || !detail.data ? (
            <Skeleton className="h-56 w-full" />
          ) : step === 0 ? (
            <div className="space-y-5">
              <dl className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
                <Row label="Valor liberado" value={formatCents(detail.data.offer.net_amount_cents)} />
                <Row label="Base do crédito" value={formatCents(detail.data.offer.amount_cents)} />
                <Row label="Custo total" value={formatCents(detail.data.offer.total_cost_cents)} />
                <Row label="CET do período" value={formatPct(detail.data.offer.cet_pct, 2)} />
                <Row label="Prazo" value={`${detail.data.offer.term_months} meses`} />
              </dl>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Impacto no seu caixa</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ImpactBox
                    label="30 dias"
                    before={detail.data.impact.gap_30_before_cents}
                    after={detail.data.impact.gap_30_after_cents}
                  />
                  <ImpactBox
                    label="90 dias"
                    before={detail.data.impact.gap_90_before_cents}
                    after={detail.data.impact.gap_90_after_cents}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Parcelas</p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {detail.data.schedule.map((s) => (
                    <li key={s.installment} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="text-muted-foreground">
                        {s.installment}ª · {new Date(`${s.due_date}T00:00:00`).toLocaleDateString("pt-BR")}
                      </span>
                      <MoneyText cents={s.amount_cents} className="text-xs" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 text-warning" aria-hidden />
                <p>
                  Ao assinar, {formatCents(detail.data.offer.net_amount_cents)} entram hoje como{" "}
                  <code className="font-mono">loan_in</code> e as parcelas viram{" "}
                  <code className="font-mono">loan_out</code> no Caixa do imposto. A operação fica
                  registrada em auditoria.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signature">Assinatura (nome completo)</Label>
                <Input
                  id="signature"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Como consta no contrato social"
                  autoComplete="off"
                />
              </div>
              <FormError message={error} />
            </div>
          )}
        </div>
      </SideSheet>

      {/* drawer do contrato: timeline + ledger */}
      <SideSheet
        open={Boolean(contractId)}
        onOpenChange={(open) => {
          if (!open) setContractId(null);
        }}
        title="Contrato"
        description="Timeline de repagamento e extrato do contrato."
      >
        {contract.isLoading || !contract.data ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="space-y-5">
            <dl className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <Row
                label="Produto"
                value={OFFER_COPY[contract.data.contract.kind]?.title ?? contract.data.contract.kind}
              />
              <Row label="Liberado" value={formatCents(contract.data.contract.net_disbursed_cents)} />
              <Row label="Total devido" value={formatCents(contract.data.contract.total_due_cents)} />
              <Row label="CET" value={formatPct(contract.data.contract.cet_pct, 2)} />
              <Row label="Assinado por" value={contract.data.contract.signature_ref} />
              <Row
                label="Data"
                value={new Date(contract.data.contract.signed_at).toLocaleString("pt-BR")}
              />
            </dl>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Repagamento</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {contract.data.repayments.map((r) => (
                  <li key={r.installment} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-muted-foreground">
                      {r.installment}ª · {new Date(`${r.due_date}T00:00:00`).toLocaleDateString("pt-BR")}
                    </span>
                    <span className="flex items-center gap-2">
                      <MoneyText cents={r.amount_cents} className="text-xs" />
                      <Badge variant={r.paid_at ? "secondary" : "outline"}>
                        {r.paid_at ? "pago" : "aberto"}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Extrato</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {contract.data.ledger.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-muted-foreground">
                      {new Date(`${l.entry_date}T00:00:00`).toLocaleDateString("pt-BR")} ·{" "}
                      {LEDGER_COPY[l.kind] ?? l.kind}
                    </span>
                    <MoneyText cents={l.amount_cents} className="text-xs" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </SideSheet>
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular">{value}</dd>
    </div>
  );
}

function ImpactBox({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground line-through">
        <MoneyText cents={before} className="text-xs" />
      </p>
      <p className="text-sm font-semibold">
        <MoneyText cents={after} sign />
      </p>
    </div>
  );
}
