import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";
import { buildOrganizationTheme, toOrgThemeStyle } from "../lib/organizationTheme.js";

// Organization Theme (dashboard) — Premium Fase 2D.1. Montado EXCLUSIVAMENTE
// alrededor de las rutas organizer (ver AppShell.jsx) — nunca alrededor de
// Developer/Scanner. Fuente de datos: la MISMA GET /api/organizations/me
// que ya usa el resto del panel organizer (OrganizerSettings, etc.) — no se
// agrega ningún endpoint nuevo ni otra resolución por ownerId.
//
// Autoridad de CUSTOM_BRANDING: exclusivamente server-side, vía
// `organization.branding.enabled` (ya resuelto por
// isFeatureAvailable(organization, PremiumFeature.CUSTOM_BRANDING) en
// getMyOrganizationService). Este Context NUNCA decide por `organization.plan`
// — ver corrección post-revisión 2D.1 (el frontend no es la autoridad de
// qué feature desbloquea qué plan).
const OrganizationThemeContext = createContext({
  organization: null,
  brandingEnabled: false,
  themeStyle: undefined,
  loading: true,
  applyBrandingUpdate: () => {},
});

export function OrganizationThemeProvider({ children }) {
  const { getToken } = useAuth();
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { organization: org } = await apiFetch("/api/organizations/me", { token });
        if (!cancelled) setOrganization(org || null);
      } catch (err) {
        console.error("OrganizationThemeProvider: no se pudo cargar la organización", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Llamado por OrganizationBrandingCard justo después de un PATCH exitoso
  // — actualización INMEDIATA del theme (logo/color) sin logout/login/
  // refresh, sin volver a pedir /me.
  const applyBrandingUpdate = useCallback((partial) => {
    setOrganization((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  // Autoridad server-side EXCLUSIVA — nunca `organization.plan === "PREMIUM"`
  // acá. `organization.branding.enabled` ya viene resuelto por
  // isFeatureAvailable(organization, PremiumFeature.CUSTOM_BRANDING) en
  // getMyOrganizationService (backend/src/services/organization.service.js).
  const brandingEnabled = Boolean(organization?.branding?.enabled);
  const theme = useMemo(
    () =>
      brandingEnabled
        ? buildOrganizationTheme(organization?.brandPrimaryColor, organization?.brandSecondaryColor)
        : null,
    [brandingEnabled, organization?.brandPrimaryColor, organization?.brandSecondaryColor]
  );
  const themeStyle = theme ? toOrgThemeStyle(theme) : undefined;

  const value = useMemo(
    () => ({ organization, brandingEnabled, themeStyle, loading, applyBrandingUpdate }),
    [organization, brandingEnabled, themeStyle, loading, applyBrandingUpdate]
  );

  return <OrganizationThemeContext.Provider value={value}>{children}</OrganizationThemeContext.Provider>;
}

export function useOrganizationTheme() {
  return useContext(OrganizationThemeContext);
}
