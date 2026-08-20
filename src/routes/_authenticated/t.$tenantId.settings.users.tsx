import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Copy, Loader2, Mail, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { InfoHint } from "@/components/techiva/info-hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormError } from "@/components/auth/auth-shell";
import { ROLE_LABELS, authErrorMessage, roleRequiresMfa, type MemberRole } from "@/lib/auth";
import {
  ROLES_BY_KIND,
  inviteLink,
  isAdminRole,
  useCanAdmin,
  useInvitations,
  useMemberMutations,
  useMembers,
  type Invitation,
  type TenantMember,
} from "@/lib/members";
import { sendInviteEmail } from "@/lib/invite-email.functions";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/settings/users")({
  head: () => ({
    meta: [
      { title: "Usuários da organização — TECH-IVA" },
      {
        name: "description",
        content:
          "Membros, papéis e convites da organização ativa no TECH-IVA, com permissões validadas no banco.",
      },
      { property: "og:title", content: "Usuários da organização — TECH-IVA" },
      {
        property: "og:description",
        content: "Gestão de membros, papéis e convites por organização no TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersPage,
});

const INVITE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  accepted: "Aceito",
  expired: "Expirado",
  revoked: "Revogado",
};

function UsersPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const canAdminQuery = useCanAdmin(tenantId);
  const members = useMembers(tenantId);
  const invitations = useInvitations(tenantId);
  const { invite, setRole, remove, revoke } = useMemberMutations(tenantId);
  const sendInvite = useServerFn(sendInviteEmail);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<TenantMember | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const canAdmin = canAdminQuery.data === true;
  const kind = shell.data?.tenant.kind;
  const roleOptions = kind ? ROLES_BY_KIND[kind] : [];
  const adminCount = (members.data ?? []).filter((m) => isAdminRole(m.role)).length;

  if (members.error) {
    return <FormError message={authErrorMessage(members.error)} />;
  }

  async function handleRoleChange(member: TenantMember, role: MemberRole) {
    try {
      await setRole.mutateAsync({ userId: member.user_id, role });
      toast.success(`Papel de ${member.email ?? "membro"} alterado para ${ROLE_LABELS[role]}.`);
    } catch (error) {
      toast.error(authErrorMessage(error));
    }
  }

  async function handleRemove() {
    if (!pendingRemoval) return;
    const member = pendingRemoval;
    setPendingRemoval(null);
    try {
      await remove.mutateAsync(member.user_id);
      toast.success(`${member.email ?? "Membro"} removido da organização.`);
    } catch (error) {
      toast.error(authErrorMessage(error));
    }
  }

  async function handleRevoke(invitation: Invitation) {
    try {
      await revoke.mutateAsync(invitation.id);
      toast.success("Convite revogado.");
    } catch (error) {
      toast.error(authErrorMessage(error));
    }
  }

  async function deliverInvite(tenantId: string, invitationId: string, token: string, email: string) {
    try {
      await sendInvite({
        data: { tenantId, invitationId, token, origin: window.location.origin },
      });
      toast.success(`Convite enviado por e-mail para ${email}.`);
    } catch (error) {
      toast.warning(
        `Convite criado, mas o e-mail não pôde ser enviado (${authErrorMessage(error)}). Use o link abaixo.`,
      );
    }
  }

  async function handleResend(invitation: Invitation) {
    try {
      await revoke.mutateAsync(invitation.id);
      const { invitationId, token } = await invite.mutateAsync({
        email: invitation.email,
        role: invitation.role,
      });
      setLastLink(inviteLink(token));
      await deliverInvite(tenantId, invitationId, token, invitation.email);
    } catch (error) {
      toast.error(authErrorMessage(error));
    }
  }

  const pendingInvites = (invitations.data ?? []).filter((i) => i.status === "pending").length;

  return (
    <Page className="max-w-5xl">
      <PageHeader
        eyebrow="Administração"
        title="Usuários"
        help={
          <>
            Membros e convites de {shell.data?.tenant.name ?? "sua organização"}. Papéis e permissões
            são validados no banco — o que aparece aqui é o que o banco permite, não o que a tela
            esconde. Papéis administrativos exigem MFA.
          </>
        }
        actions={
          canAdmin ? (
            <Button onClick={() => setInviteOpen(true)} className="cta-lift gap-2">
              <UserPlus className="size-4" />
              Convidar
            </Button>
          ) : null
        }
      />

      {canAdminQuery.data === false ? (
        <Rise index={1}>
          <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-1/60 px-3 py-2 text-sm text-muted-foreground">
            <ShieldAlert className="size-4 shrink-0" />
            Você tem acesso somente de leitura nesta organização.
          </p>
        </Rise>
      ) : null}

      {lastLink ? (
        <Rise index={1}>
          <InviteLinkCard link={lastLink} onDismiss={() => setLastLink(null)} />
        </Rise>
      ) : null}

      <Rise index={2} className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Membros" value={String((members.data ?? []).length)} loading={members.isLoading} />
        <Kpi
          label="Administradores"
          value={String(adminCount)}
          hint="Papéis administrativos exigem MFA"
          loading={members.isLoading}
        />
        <Kpi
          label="Convites pendentes"
          value={String(pendingInvites)}
          loading={invitations.isLoading}
        />
      </Rise>

      <Rise index={3}>
        <Segmented
          label="Seção de usuários"
          value={tab}
          onChange={setTab}
          options={[
            { value: "members", label: "Membros" },
            { value: "invites", label: "Convites" },
          ]}
        />
      </Rise>

      {tab === "members" ? (
        <Rise index={4}>
          <Panel title="Membros da organização" bodyClassName="p-0">
            {members.isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (members.data ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Users}
                  title="Nenhum membro nesta organização"
                  hint="Convide as pessoas que vão operar esta empresa. O papel define o que cada uma pode ver e fazer."
                  {...(canAdmin
                    ? {
                        action: (
                          <Button className="cta-lift gap-2" onClick={() => setInviteOpen(true)}>
                            <UserPlus className="size-4" />
                            Convidar pessoa
                          </Button>
                        ),
                      }
                    : {})}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="th-label px-4 py-2 text-left">Pessoa</th>
                      <th className="th-label px-4 py-2 text-left">Papel</th>
                      <th className="th-label hidden px-4 py-2 text-left md:table-cell">Desde</th>
                      <th className="th-label w-16 px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {members.data!.map((member) => {
                      const lastAdmin = isAdminRole(member.role) && adminCount <= 1;
                      return (
                        <tr key={member.user_id} className="row-hover border-b border-border/40">
                          <td className="px-4 py-3">
                            <span className="block text-sm text-foreground">
                              {member.full_name ?? "Sem nome"}
                            </span>
                            <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                              {member.email ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {canAdmin ? (
                              <Select
                                value={member.role}
                                onValueChange={(value) =>
                                  void handleRoleChange(member, value as MemberRole)
                                }
                                disabled={setRole.isPending || lastAdmin}
                              >
                                <SelectTrigger className="focus-glow w-52">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {roleOptions.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {ROLE_LABELS[role]}
                                      {roleRequiresMfa(role) ? " · MFA" : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="outline" className="rounded-full">
                                {ROLE_LABELS[member.role]}
                              </Badge>
                            )}
                            {lastAdmin ? (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                Último administrador — papel protegido.
                              </span>
                            ) : null}
                          </td>
                          <td className="hidden px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground md:table-cell">
                            {new Date(member.created_at).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="px-4 py-3">
                            {canAdmin ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remover ${member.email ?? "membro"}`}
                                disabled={remove.isPending || lastAdmin}
                                onClick={() => setPendingRemoval(member)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </Rise>
      ) : (
        <Rise index={4}>
          <Panel title="Convites" bodyClassName="p-0">
            {invitations.isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (invitations.data ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Mail}
                  title="Nenhum convite registrado"
                  hint="Convites pendentes expiram automaticamente. O link de aceite aparece uma única vez."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="th-label px-4 py-2 text-left">E-mail</th>
                      <th className="th-label px-4 py-2 text-left">Papel</th>
                      <th className="th-label px-4 py-2 text-left">Status</th>
                      <th className="th-label hidden px-4 py-2 text-left md:table-cell">Expira</th>
                      <th className="th-label w-40 px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.data!.map((invitation) => (
                      <tr key={invitation.id} className="row-hover border-b border-border/40">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">
                          {invitation.email}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="rounded-full">
                            {ROLE_LABELS[invitation.role]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Semaphore
                            level={INVITE_LEVEL[invitation.status] ?? "info"}
                            label={INVITE_STATUS_LABELS[invitation.status] ?? invitation.status}
                          />
                        </td>
                        <td className="hidden px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground md:table-cell">
                          {new Date(invitation.expires_at).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-3">
                          {canAdmin && invitation.status === "pending" ? (
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={invite.isPending || revoke.isPending}
                                onClick={() => void handleResend(invitation)}
                              >
                                Reenviar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={revoke.isPending}
                                onClick={() => void handleRevoke(invitation)}
                              >
                                Revogar
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </Rise>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roleOptions}
        pending={invite.isPending}
        onSubmit={async (email, role) => {
          try {
            const { invitationId, token } = await invite.mutateAsync({ email, role });
            setInviteOpen(false);
            setLastLink(inviteLink(token));
            await deliverInvite(tenantId, invitationId, token, email);
          } catch (error) {
            toast.error(authErrorMessage(error));
          }
        }}
      />

      <AlertDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => (open ? null : setPendingRemoval(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoval?.email ?? "Este membro"} perde o acesso a esta organização e a todas as
              suas descendentes. A ação fica registrada na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRemove()}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LoadingRows({ columns }: { columns: number }) {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <TableRow key={row}>
          {Array.from({ length: columns }).map((_, cell) => (
            <TableCell key={cell}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function InviteLinkCard({ link, onDismiss }: { link: string; onDismiss: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Mail className="size-4" />
        Link de aceite do convite
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        O token aparece uma única vez.
        <InfoHint title="Link de convite">
          Envie este link para a pessoa convidada — o e-mail automático entra com o serviço de envio
          do bloco 02.
        </InfoHint>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-background px-3 py-2 font-mono text-xs text-foreground">
          {link}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast.success("Link copiado.");
          }}
        >
          <Copy className="size-4" />
          Copiar
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Ocultar
        </Button>
      </div>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  roles,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: MemberRole[];
  pending: boolean;
  onSubmit: (email: string, role: MemberRole) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole | "">("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setEmail("");
          setRole("");
          setError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>
            O papel disponível depende do tipo desta organização. O convite expira em 7 dias.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = email.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
              setError("Informe um e-mail válido.");
              return;
            }
            if (!role) {
              setError("Escolha um papel.");
              return;
            }
            setError(null);
            void onSubmit(value, role);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              placeholder="pessoa@empresa.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role">Papel</Label>
            <Select value={role} onValueChange={(value) => setRole(value as MemberRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue placeholder="Selecione o papel" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role && roleRequiresMfa(role) ? (
              <p className="text-xs text-muted-foreground">
                Este papel exige verificação em duas etapas para operar.
              </p>
            ) : null}
          </div>

          {error ? <FormError message={error} /> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Criar convite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
