import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  locale: string;
  last_tenant: string | null;
};

export type ProfileView = {
  profile: Profile | null;
  email: string | null;
  userId: string;
  /** URL assinada do avatar (bucket privado `avatars`). */
  avatarSignedUrl: string | null;
  /** Nível de garantia atual da sessão: aal1 (senha) ou aal2 (senha + TOTP). */
  aal: string | null;
  /** Fatores TOTP verificados. */
  totpFactors: Array<{ id: string; friendly_name?: string | null; status: string }>;
  lastSignInAt: string | null;
};

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<ProfileView> => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const user = userData.user;
      if (!user) throw new Error("Sessão expirada.");

      const [{ data: profile, error }, factors, aal] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, avatar_url, phone, locale, last_tenant")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (error) throw error;

      let avatarSignedUrl: string | null = null;
      const path = profile?.avatar_url ?? null;
      if (path && !path.startsWith("http")) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(path, 60 * 60);
        avatarSignedUrl = signed?.signedUrl ?? null;
      } else {
        avatarSignedUrl = path;
      }

      return {
        profile: (profile ?? null) as Profile | null,
        email: user.email ?? null,
        userId: user.id,
        avatarSignedUrl,
        aal: aal.data?.currentLevel ?? null,
        totpFactors: (factors.data?.totp ?? []) as ProfileView["totpFactors"],
        lastSignInAt: user.last_sign_in_at ?? null,
      };
    },
  });
}

export function useProfileMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["profile"] });

  const save = useMutation({
    mutationFn: async ({
      userId,
      full_name,
      phone,
    }: {
      userId: string;
      full_name: string;
      phone: string;
    }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: full_name || null, phone: phone || null })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const uploadAvatar = useMutation({
    mutationFn: async ({ userId, file }: { userId: string; file: File }) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });
      if (uploadError) throw uploadError;
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const removeAvatar = useMutation({
    mutationFn: async ({ userId, path }: { userId: string; path: string | null }) => {
      if (path && !path.startsWith("http")) {
        await supabase.storage.from("avatars").remove([path]);
      }
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const unenrollTotp = useMutation({
    mutationFn: async (factorId: string) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { save, uploadAvatar, removeAvatar, unenrollTotp };
}
