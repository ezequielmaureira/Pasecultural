import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";

// Organization Theme (dashboard) — Premium Light Theme fijo. Montado
// EXCLUSIVAMENTE alrededor de las rutas organizer (ver AppShell.jsx) —
// nunca alrededor de Developer/Scanner. Fuente de verdad: la misma GET
// /api/organizations/me que ya usa el resto del panel organizer.
//
// Decisión de producto: se canceló la personalización de colores por
// organización (ex 2D.1/2D.1.1/2D.1.2). Este Context ya NO reconstruye
// ningún theme ni mantiene un cache visual optimista — sólo distribuye la
// identidad confirmada por el server (organization: nombre/slug/logo) y si
// corresponde aplicar el Premium Light Theme FIJO (`brandingEnabled`, vía
// ORG_THEME_CLASS en lib/organizationTheme.js).
//
// Autoridad: exclusivamente server-side, vía `organization.branding.enabled`
// (ya resuelto por isFeatureAvailable(organization, PremiumFeature.CUSTOM_BRANDING)
// en getMyOrganizationService). Este Context NUNCA decide por `organization.plan`.
//
// `loading: false` / `confirmed: true` por default (sin Provider ancestro,
// ej. Developer) a propósito — significa "no aplica ningún bootstrap acá",
// nunca "todavía cargando".
const OrganizationThemeContext = createContext({
  organization: null,
  brandingEnabled: false,
  loading: false,
  confirmed: true,
  applyBrandingUpdate: () => {},
});

export function OrganizationThemeProvider({ children }) {
  const { getToken, userId } = useAuth();
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { organization: org } = await apiFetch("/api/organizations/me", { token });
        if (!cancelled) setOrganization(org || null);
      } catch (err) {
        console.error("OrganizationThemeProvider: no se pudo cargar la organización", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setConfirmed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, getToken]);

  // Llamado por OrganizationBrandingCard justo después de un PATCH exitoso
  // de logo — actualización inmediata sin volver a pedir /me. Ya no
  // persiste ningún cache de colores: sólo actualiza el estado en memoria.
  const applyBrandingUpdate = useCallback((partial) => {
    setOrganization((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  const brandingEnabled = Boolean(organization?.branding?.enabled);

  const value = useMemo(
    () => ({ organization, brandingEnabled, loading, confirmed, applyBrandingUpdate }),
    [organization, brandingEnabled, loading, confirmed, applyBrandingUpdate]
  );

  return <OrganizationThemeContext.Provider value={value}>{children}</OrganizationThemeContext.Provider>;
}

export function useOrganizationTheme() {
  return useContext(OrganizationThemeContext);
}
