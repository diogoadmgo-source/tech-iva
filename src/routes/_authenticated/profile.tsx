import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";

import { FormError } from "@/components/auth/auth-shell";
import { Page, PageHeader, Panel, Rise, Segmented } from "@/components/techiva/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { useProfile, useProfileMutations } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Meu perfil · TECH-IVA" },
      {
        name: "description",
        content:
          "Dados pessoais, foto, segunda etapa de verificação (TOTP) e sessão ativa da sua conta TECH-IVA.",
      },
      { property: "og:title", content: "Meu perfil · TECH-IVA" },
      {
        property: "og:description",
        content: "Gerencie nome, telefone, avatar, MFA e sessão da sua conta TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const profile = useProfile();
  const { save, uploadAvatar, removeAvatar, unenrollTotp } = useProfileMutations();
  const fileInput = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [tab, setTab] = useState<"dados" | "seguranca">("dados");

  useEffect(() => {
    if (!profile.data) return;
    setFullName(profile.data.profile?.full_name ?? "");
    setPhone(profile.data.profile?.phone ?? "");
  }, [profile.data]);

  if (profile.isLoading) {
    return (
      <Page className="max-w-3xl">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </Page>
    );
  }

  const data = profile.data;
  if (!data) {
    return (
      <Page className="max-w-3xl">
        <FormError message={authErrorMessage(profile.error)} />
      </Page>
    );
  }

  const verifiedTotp = data.totpFactors.filter((f) => f.status === "verified");

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ userId: data!.userId, full_name: fullName, phone });
      toast.success("Perfil atualizado.");
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("A imagem deve ter no máximo 2 MB.");
      return;
    }
    setError(null);
    try {
      await uploadAvatar.mutateAsync({ userId: data!.userId, file });
      toast.success("Foto atualizada.");
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  async function signOutEverywhere() {
    setSigningOut(true);
    const { error: err } = await supabase.auth.signOut({ scope: "global" });
    setSigningOut(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    await navigate({ to: "/login" });
  }

  return (
    <Page className="max-w-3xl">
      <PageHeader
        eyebrow="CONTA"
        title="Meu perfil"
        help={
          <p>
            Dados pessoais, foto, verificação em duas etapas (TOTP) e sessões ativas da sua conta.
          </p>
        }
        actions={<span className="font-mono text-xs text-muted-foreground">{data.email}</span>}
      />

      <Rise index={1}>
        <Segmented
          label="Seção do perfil"
          value={tab}
          onChange={setTab}
          options={[
            { value: "dados", label: "Dados" },
            { value: "seguranca", label: "Segurança" },
          ]}
        />
      </Rise>

      {tab === "dados" ? (
        <Rise index={2} className="space-y-4">
          <Panel title="Foto de perfil" bodyClassName="flex flex-wrap items-center gap-4 p-4">
            {data.avatarSignedUrl ? (
              <img
                src={data.avatarSignedUrl}
                alt="Foto de perfil"
                className="size-16 rounded-full object-cover"
              />
            ) : (
              <span className="grid size-16 place-items-center rounded-full bg-surface-2">
                <UserRound className="size-6 text-muted-foreground" />
              </span>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={uploadAvatar.isPending}
              >
                {uploadAvatar.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-4" />
                )}
                Enviar foto
              </Button>
              {data.profile?.avatar_url ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void removeAvatar
                      .mutateAsync({ userId: data.userId, path: data.profile?.avatar_url ?? null })
                      .then(() => toast.success("Foto removida."))
                      .catch((err: unknown) => setError(authErrorMessage(err)))
                  }
                >
                  Remover
                </Button>
              ) : null}
            </div>
          </Panel>

          <Panel title="Dados pessoais">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="full_name">Nome completo</Label>
                <Input
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+55 11 90000-0000"
                />
              </div>
              <FormError message={error} />
              <Button onClick={() => void submit()} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Salvar
              </Button>
            </div>
          </Panel>
        </Rise>
      ) : (
        <Rise index={2} className="space-y-4">
          <Panel
            title="Verificação em duas etapas (TOTP)"
            icon={ShieldCheck}
            help={
              <p>
                Papéis de plataforma e administradores de canal precisam de TOTP para acessar o
                app.
              </p>
            }
            actions={
              <Badge variant={data.aal === "aal2" ? "secondary" : "outline"}>
                sessão {data.aal ?? "aal1"}
              </Badge>
            }
          >
            {verifiedTotp.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">Nenhum autenticador cadastrado.</p>
                <Button className="mt-3" onClick={() => void navigate({ to: "/mfa" })}>
                  Cadastrar autenticador
                </Button>
              </>
            ) : (
              <div className="space-y-2">
                {verifiedTotp.map((factor) => (
                  <div
                    key={factor.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {factor.friendly_name || factor.id.slice(0, 8)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void unenrollTotp
                          .mutateAsync(factor.id)
                          .then(() => toast.success("Autenticador removido."))
                          .catch((err: unknown) => setError(authErrorMessage(err)))
                      }
                    >
                      Remover
                    </Button>
                  </div>
                ))}
                <Button variant="outline" onClick={() => void navigate({ to: "/mfa" })}>
                  Adicionar outro
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="Sessão">
            <p className="font-mono text-xs text-muted-foreground">
              último acesso{" "}
              {data.lastSignInAt ? new Date(data.lastSignInAt).toLocaleString("pt-BR") : "—"}
            </p>
            <FormError message={error} />
            <Button
              className="mt-3"
              variant="destructive"
              onClick={() => void signOutEverywhere()}
              disabled={signingOut}
            >
              {signingOut ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Encerrar sessões em todos os dispositivos
            </Button>
          </Panel>
        </Rise>
      )}
    </Page>
  );
}
