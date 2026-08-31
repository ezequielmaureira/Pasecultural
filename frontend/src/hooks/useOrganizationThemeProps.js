import { buildOrganizationTheme, toOrgThemeStyle, ORG_THEME_CLASS } from "../lib/organizationTheme.js";
import { useRegisterPublicBranding } from "../context/PublicBrandingContext.jsx";

// Organization Theme (público) — Premium Fase 2D.1. Compartido por
// EventDetail y PurchaseWizard (OrganizationProfile tiene su propio cálculo
// porque su shape de datos ya viene separado en organization/branding).
// `primaryColor` no-nulo es la única señal que llega del backend cuando
// CUSTOM_BRANDING está disponible — nunca se vuelve a chequear plan acá.
export function useOrganizationThemeProps({ slug, name, logo, primaryColor } = {}) {
  const publicBranding = primaryColor
    ? { slug, name, logo, theme: buildOrganizationTheme(primaryColor) }
    : null;

  useRegisterPublicBranding(publicBranding);

  if (!publicBranding) {
    return { publicBranding: null, className: "", style: undefined };
  }

  return {
    publicBranding,
    className: ORG_THEME_CLASS,
    style: { ...toOrgThemeStyle(publicBranding.theme), backgroundColor: "var(--org-bg)" },
  };
}
