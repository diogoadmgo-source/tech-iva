import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Filter, RotateCcw, ScrollText } from "lucide-react";

import { FormError } from "@/components/auth/auth-shell";
import { EmptyState } from "@/components/techiva/empty-state";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
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
import { authErrorMessage } from "@/lib/auth";
import {
  AUDIT_PAGE_SIZE,
  EMPTY_AUDIT_FILTERS,
  jsonDiff,
  useAuditLog,
  type AuditFilters,
} from "@/lib/audit";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/audit")({
  head: () => ({
    meta: [
      { title: "Auditoria · TECH-IVA" },
      {
        name: "description",
        content:
          "Trilha de auditoria imutável do TECH-IVA: ações, autores, papéis e diff das alterações por organização.",
      },
      { property: "og:title", content: "Auditoria · TECH-IVA" },
      {
        property: "og:description",
        content: "Consulta paginada e filtrável do log de auditoria da hierarquia de organizações.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  const audit = useAuditLog(tenantId, applied, page);
  const total = audit.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / AUDIT_PAGE_SIZE) - 1);

  return (
    <Page>
      <PageHeader
        eyebrow="administração"
        title="Auditoria"
        helpTitle="Sobre esta trilha"
        help={
          <p>
            Registros de <strong>{shell.data?.tenant.name ?? "…"}</strong> e seus descendentes. A
            trilha é imutável — não há edição nem exclusão.
          </p>
        }
      />

      <Rise index={1}>
        <Panel title="Filtros" icon={Filter}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="action">Ação</Label>
              <Input
                id="action"
                placeholder="tenant.create"
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity">Entidade</Label>
              <Input
                id="entity"
                placeholder="membership"
                value={filters.entity}
                onChange={(e) => setFilters({ ...filters, entity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="actor">Autor (user id)</Label>
              <Input
                id="actor"
                placeholder="uuid"
                value={filters.actor}
                onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">De</Label>
              <Input
                id="from"
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">Até</Label>
              <Input
                id="to"
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
              <Button
                onClick={() => {
                  setPage(0);
                  setApplied(filters);
                }}
              >
                <Filter className="mr-2 size-4" /> Aplicar filtros
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters(EMPTY_AUDIT_FILTERS);
                  setApplied(EMPTY_AUDIT_FILTERS);
                  setPage(0);
                }}
              >
                <RotateCcw className="mr-2 size-4" /> Limpar
              </Button>
            </div>
          </div>
        </Panel>
      </Rise>

      <FormError message={audit.error ? authErrorMessage(audit.error) : null} />

      <Rise index={2}>
        <Panel title="Registros" icon={ScrollText}>
          {audit.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (audit.data?.rows ?? []).length === 0 ? (
            <EmptyState
              title="Nenhum registro para os filtros aplicados"
              hint="Ajuste o período, a ação ou a entidade — a trilha guarda tudo, mas só mostra o que casa com o filtro."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="th-label w-10" />
                    <th scope="col" className="th-label">Quando</th>
                    <th scope="col" className="th-label">Ação</th>
                    <th scope="col" className="th-label">Entidade</th>
                    <th scope="col" className="th-label">Papel</th>
                    <th scope="col" className="th-label">Autor</th>
                  </tr>
                </thead>
                <tbody>
                  {(audit.data?.rows ?? []).map((row) => {
                    const open = expanded === row.id;
                    const diff = jsonDiff(row.before, row.after);
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className="row-hover cursor-pointer border-b border-border/60"
                          onClick={() => setExpanded(open ? null : row.id)}
                        >
                          <td className="px-3 py-2">
                            {open ? (
                              <ChevronDown className="size-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-4 text-muted-foreground" />
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono tabular text-xs text-muted-foreground">
                            {new Date(row.at).toLocaleString("pt-BR")}
                          </td>
                          <td className="px-3 py-2 font-mono tabular text-xs">{row.action}</td>
                          <td className="px-3 py-2 text-sm">
                            {row.entity}
                            {row.entity_id ? (
                              <span className="ml-1 font-mono tabular text-xs text-muted-foreground">
                                {row.entity_id.slice(0, 8)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {row.actor_role ? (
                              <Badge
                                variant="outline"
                                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                              >
                                {row.actor_role}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono tabular text-xs">
                            {row.actor_id ? row.actor_id.slice(0, 8) : "sistema"}
                            {row.impersonated_by ? (
                              <Badge variant="destructive" className="ml-2 rounded-full">
                                impersonado
                              </Badge>
                            ) : null}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-border/60">
                            <td colSpan={6} className="bg-surface-2/60 px-3 py-3">
                              {diff.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Sem payload de antes/depois neste registro.
                                </p>
                              ) : (
                                <div className="space-y-1">
                                  {diff.map((line) => (
                                    <div
                                      key={line.key}
                                      className="grid grid-cols-[10rem_1fr_1fr] gap-2 font-mono tabular text-xs"
                                    >
                                      <span className="text-muted-foreground">{line.key}</span>
                                      <span
                                        className={
                                          line.changed ? "text-destructive" : "text-muted-foreground"
                                        }
                                      >
                                        {line.before}
                                      </span>
                                      <span className={line.changed ? "text-primary" : "text-muted-foreground"}>
                                        {line.after}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {row.ip || row.user_agent ? (
                                <p className="mt-3 font-mono tabular text-xs text-muted-foreground">
                                  {row.ip ?? "sem ip"} · {row.user_agent ?? "sem user-agent"}
                                </p>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}


          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted-foreground">
              {total.toLocaleString("pt-BR")}
              {audit.data?.approx ? " (aprox.)" : ""} registro(s) · página {page + 1} de {lastPage + 1}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </Panel>
      </Rise>
    </Page>
  );
}
