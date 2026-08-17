import { z } from "zod";

/** Regras de senha do documento 01 §1.4: mínimo 10 caracteres, letra e número. */
export const MIN_PASSWORD_LENGTH = 10;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Informe seu e-mail.")
  .max(254, "E-mail muito longo.")
  .email("E-mail inválido.");

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(72, "A senha deve ter no máximo 72 caracteres.")
  .regex(/[A-Za-zÀ-ÿ]/, "A senha deve conter ao menos uma letra.")
  .regex(/\d/, "A senha deve conter ao menos um número.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe sua senha."),
});

export const magicLinkSchema = z.object({ email: emailSchema });

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "Informe seu nome completo.")
    .max(120, "Nome muito longo."),
  email: emailSchema,
  password: passwordSchema,
});

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "As senhas não coincidem.",
  });

export const totpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "O código deve ter 6 dígitos numéricos."),
});

export type FieldErrors = Record<string, string>;

/** Valida e devolve { data } ou { fieldErrors } — sem lançar exceção. */
export function validate<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): { data: z.infer<S>; fieldErrors: null } | { data: null; fieldErrors: FieldErrors } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { data: parsed.data, fieldErrors: null };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] != null ? String(issue.path[0]) : "form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { data: null, fieldErrors };
}

/** Força da senha (0–4) para o medidor visual do cadastro/reset. */
export function passwordStrength(value: string): { score: number; label: string } {
  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score++;
  if (value.length >= 14) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  const labels = ["muito fraca", "fraca", "razoável", "boa", "forte"];
  return { score, label: labels[score] ?? "muito fraca" };
}

/**
 * Erros que o Supabase Auth devolve no próprio link (hash ou query),
 * ex.: #error=access_denied&error_code=otp_expired.
 */
export function linkErrorFromUrl(href: string): string | null {
  if (!href) return null;
  let search = "";
  let hash = "";
  try {
    const url = new URL(href);
    search = url.search.startsWith("?") ? url.search.slice(1) : url.search;
    hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  } catch {
    return null;
  }
  for (const chunk of [hash, search]) {
    if (!chunk) continue;
    const params = new URLSearchParams(chunk);
    const code = params.get("error_code");
    const description = params.get("error_description") ?? params.get("error");
    if (!code && !description) continue;
    if (code === "otp_expired") return "Este link expirou. Solicite um novo e-mail.";
    if (code === "access_denied" || code === "invalid_request")
      return "Link inválido ou já utilizado. Solicite um novo e-mail.";
    if (description) return decodeURIComponent(description.replace(/\+/g, " "));
  }
  return null;
}
