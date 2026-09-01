import { ORG_THEME_CLASS } from "../lib/organizationTheme.js";
import { useRegisterPublicBranding } from "../context/PublicBrandingContext.jsx";

// Organization Theme (público) — Premium Light Theme fijo. Compartido por
// EventDetail y PurchaseWizard (OrganizationProfile tiene su propio cálculo
// porque su shape de datos ya viene separado en organization/branding).
// `enabled` es la ÚNICA señal de activación — llega directo de
// `branding.enabled` (server, isFeatureAvailable(CUSTOM_BRANDING)). Nunca
// se deriva de primaryColor/secondaryColor/logo: una Organization Premium
// sin colores configurados debe activar el mismo Light Theme que una con
// colores legacy guardados.
export function useOrganizationThemeProps({ slug, name, logo, enabled } = {}) {
  const isEnabled = enabled === true;
  const publicBranding = isEnabled ? { slug, name, logo } : null;

  useRegisterPublicBranding(publicBranding);

  if (!publicBranding) {
    return { publicBranding: null, className: "", style: undefined };
  }

  return {
    publicBranding,
    className: ORG_THEME_CLASS,
    style: undefined,
  };
}
