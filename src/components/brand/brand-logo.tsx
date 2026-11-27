// Arquivos servidos de public/brand/ (antes ficavam no armazenamento de assets do Lovable).
export const brandLogoUrl = "/brand/techiva-logo.png";
export const brandIconUrl = "/brand/techiva-icon.png";

/** Lockup completo (símbolo + wordmark TECH IVA%), adaptado ao tema claro. */
export function BrandLogo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <img
      src={brandLogoUrl}
      alt="TECH-IVA"
      className={`brand-mark ${className}`}
      loading="eager"
      decoding="async"
    />
  );
}

/** Apenas o símbolo, para sidebars colapsadas, avatares e badges. */
export function BrandIcon({
  className = "size-8",
  alt = "TECH-IVA",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={brandIconUrl}
      alt={alt}
      className={`brand-mark ${className}`}
      loading="lazy"
      decoding="async"
    />
  );
}
