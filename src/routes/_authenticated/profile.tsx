import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";

import { FormError } from "@/components/auth/auth-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  useEffect(() => {
    if (!profile.data) return;
    setFullName(profile.data.profile?.full_name ?? "");
    setPhone(profile.data.profile?.phone ?? "");
  }, [profile.data]);

  if (profile.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const data = profile.data;
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <FormError message={authErrorMessage(profile.error)} />
      </div>
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
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Meu perfil</h1>
        <p className="font-mono text-sm text-muted-foreground">{data.email}</p>
      </header>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 pt-4">
          <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
            {data.avatarSignedUrl ? (
              <img
                src={data.avatarSignedUrl}
                alt="Foto de perfil"
                className="size-16 rounded-full object-cover"
              />
            ) : (
              <span className="grid size-16 place-items-center rounded-full bg-muted">
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
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
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
        </TabsContent>

        <TabsContent value="seguranca" className="space-y-4 pt-4">
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <p className="text-sm font-medium text-foreground">Verificação em duas etapas (TOTP)</p>
              <Badge variant={data.aal === "aal2" ? "secondary" : "outline"}>
                sessão {data.aal ?? "aal1"}
              </Badge>
            </div>
            {verifiedTotp.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Nenhum autenticador cadastrado. Papéis de plataforma e administradores de canal
                  precisam de TOTP para acessar o app.
                </p>
                <Button onClick={() => void navigate({ to: "/mfa" })}>Cadastrar autenticador</Button>
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
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">Sessão</p>
            <p className="font-mono text-xs text-muted-foreground">
              último acesso{" "}
              {data.lastSignInAt ? new Date(data.lastSignInAt).toLocaleString("pt-BR") : "—"}
            </p>
            <FormError message={error} />
            <Button variant="destructive" onClick={() => void signOutEverywhere()} disabled={signingOut}>
              {signingOut ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Encerrar sessões em todos os dispositivos
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
