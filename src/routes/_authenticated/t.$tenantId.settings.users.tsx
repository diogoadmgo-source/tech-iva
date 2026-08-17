import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, Loader2, Mail, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

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

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Usuários</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Membros e convites de{" "}
            <span className="font-medium text-foreground">{shell.data?.tenant.name ?? "—"}</span>.
            Papéis e permissões são validados pelo banco.
          </p>
        </div>
        {canAdmin ? (
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="size-4" />
            Convidar
          </Button>
        ) : null}
      </header>

      {canAdminQuery.data === false ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
          <ShieldAlert className="size-4 shrink-0" />
          Você tem acesso somente de leitura nesta organização.
        </p>
      ) : null}

      {lastLink ? <InviteLinkCard link={lastLink} onDismiss={() => setLastLink(null)} /> : null}

      <Tabs defaultValue="members" className="mt-6">
        <TabsList>
          <TabsTrigger value="members">Membros</TabsTrigger>
          <TabsTrigger value="invites">Convites</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead className="hidden md:table-cell">Desde</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.isLoading ? (
                  <LoadingRows columns={4} />
                ) : (members.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum membro nesta organização.
                    </TableCell>
                  </TableRow>
                ) : (
                  members.data!.map((member) => {
                    const lastAdmin = isAdminRole(member.role) && adminCount <= 1;
                    return (
                      <TableRow key={member.user_id}>
                        <TableCell>
                          <span className="block text-sm text-foreground">
                            {member.full_name ?? "Sem nome"}
                          </span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {member.email ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {canAdmin ? (
                            <Select
                              value={member.role}
                              onValueChange={(value) =>
                                void handleRoleChange(member, value as MemberRole)
                              }
                              disabled={setRole.isPending || lastAdmin}
                            >
                              <SelectTrigger className="w-52">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {roleOptions.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {ROLE_LABELS[role]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                          )}
                          {lastAdmin ? (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Último administrador — papel protegido.
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                          {new Date(member.created_at).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="invites" className="mt-4">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Expira</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.isLoading ? (
                  <LoadingRows columns={5} />
                ) : (invitations.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum convite registrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  invitations.data!.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell className="font-mono text-xs text-foreground">
                        {invitation.email}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ROLE_LABELS[invitation.role]}
                      </TableCell>
                      <TableCell>
                        <Badge variant={invitation.status === "pending" ? "secondary" : "outline"}>
                          {INVITE_STATUS_LABELS[invitation.status] ?? invitation.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {new Date(invitation.expires_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roleOptions}
        pending={invite.isPending}
        onSubmit={async (email, role) => {
          try {
            const { token } = await invite.mutateAsync({ email, role });
            setInviteOpen(false);
            setLastLink(inviteLink(token));
            toast.success(`Convite criado para ${email}.`);
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
      <p className="mt-1 text-xs text-muted-foreground">
        O token aparece uma única vez. Envie este link para a pessoa convidada — o e-mail automático
        entra com o serviço de envio do bloco 02.
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
