import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePlatformNotices, useSaveNotice, type NoticeRow } from "@/lib/notices";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/notices")({
  head: () => ({
    meta: [
      { title: "Avisos da plataforma — TECH-IVA" },
      {
        name: "description",
        content:
          "Edite os avisos exibidos nas telas de apuração, simulador, validador e integrações sem precisar de deploy.",
      },
      { property: "og:title", content: "Avisos da plataforma — TECH-IVA" },
      {
        property: "og:description",
        content: "Título, corpo, severidade e ativação de cada aviso mostrado aos clientes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NoticesPage,
});

function NoticesPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const notices = usePlatformNotices();

  const isPlatform = shell.data?.tenant?.kind === "platform";

  if (shell.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!isPlatform) {
    return <NoPermissionState hint="Os avisos exibidos aos clientes são mantidos pela plataforma." />;
  }
  if (notices.isError) {
    return (
      <ErrorState message={(notices.error as Error).message} onRetry={() => void notices.refetch()} />
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="administração"
        title="Avisos da plataforma"
        helpTitle="Sobre esta tela"
        help={
          <p>
            Estes textos aparecem no topo das telas dos clientes (apuração, simulador, validador,
            integrações e caixa). Eles mudam conforme a Receita evolui — edite aqui, sem deploy.
          </p>
        }
      />

      <Rise index={1}>
        {notices.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (notices.data?.length ?? 0) === 0 ? (
          <EmptyState title="Nenhum aviso cadastrado" />
        ) : (
          <div className="space-y-4">
            {notices.data?.map((row) => (
              <NoticeEditor key={row.key} row={row} />
            ))}
          </div>
        )}
      </Rise>
    </Page>
  );
}

function NoticeEditor({ row }: { row: NoticeRow }) {
  const save = useSaveNotice();
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  const [severity, setSeverity] = useState(row.severity);
  const [active, setActive] = useState(row.active);

  const dirty =
    title !== row.title || body !== row.body || severity !== row.severity || active !== row.active;

  async function persist(next?: Partial<NoticeRow>) {
    try {
      await save.mutateAsync({
        key: row.key,
        scope: row.scope,
        title,
        body,
        severity,
        active,
        ...next,
      });
      toast.success("Aviso atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar o aviso.");
    }
  }

  return (
    <Panel bodyClassName="p-5" interactive={false}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="size-4 text-primary" aria-hidden />
          <Badge variant="outline" className="font-mono text-[10px]">
            {row.scope}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{row.key}</span>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`active-${row.key}`} className="text-xs text-muted-foreground">
            {active ? "ativo" : "inativo"}
          </Label>
          <Switch
            id={`active-${row.key}`}
            checked={active}
            onCheckedChange={(v) => {
              setActive(v);
              void persist({ active: v });
            }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-2">
          <Label htmlFor={`title-${row.key}`}>Título</Label>
          <Input id={`title-${row.key}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`sev-${row.key}`}>Severidade</Label>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger id={`sev-${row.key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="warning">warning</SelectItem>
              <SelectItem value="critical">critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Label htmlFor={`body-${row.key}`}>Corpo</Label>
        <Textarea
          id={`body-${row.key}`}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => void persist()}>
          {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Salvar
        </Button>
        <span className="text-xs text-muted-foreground">
          Atualizado em {new Date(row.updated_at).toLocaleString("pt-BR")}
        </span>
      </div>
    </Panel>
  );
}
