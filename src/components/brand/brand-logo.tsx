import logoAsset from "@/assets/techiva-logo.png.asset.json";
import iconAsset from "@/assets/techiva-icon.png.asset.json";

export const brandLogoUrl = logoAsset.url;
export const brandIconUrl = iconAsset.url;

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
    <img src={brandIconUrl} alt={alt} className={`brand-mark ${className}`} loading="lazy" decoding="async" />
  );
}
