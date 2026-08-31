import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";
import { buildOrganizationTheme, toOrgThemeStyle } from "../lib/organizationTheme.js";
import {
  readOrganizationThemeCache,
  writeOrganizationThemeCache,
  clearOrganizationThemeCache,
} from "../lib/organizationThemeCache.js";

// Organization Theme (dashboard) — Premium Fase 2D.1 / 2D.1.1 / 2D.1.2
// (bootstrap sin flash). Montado EXCLUSIVAMENTE alrededor de las rutas
// organizer (ver AppShell.jsx) — nunca alrededor de Developer/Scanner.
// Fuente de verdad REAL: la MISMA GET /api/organizations/me que ya usa el
// resto del panel organizer — no se agrega ningún endpoint nuevo ni otra
// resolución por ownerId.
//
// Separación explícita 2D.1.2:
//   - `organization`: objeto CONFIRMADO por el server (null hasta que
//     resuelve el primer fetch exitoso). Es lo único que se usa para
//     identidad real (slug/name/link a /organizacion/:slug) y para
//     cualquier decisión funcional.
//   - `visualBranding`: { logo, primaryColor, secondaryColor } — puede
//     venir del cache local ANTES de que exista `organization`. Es
//     puramente optimista/visual, nunca se trata como Organization real.
//   - `brandingEnabled`: true si el cache optimista O el server confirmado
//     dicen que sí — nunca decide autorización, sólo qué CSS aplicar.
//   - `confirmed`: true recién cuando el server respondió al menos una vez
//     (éxito o fallo definitivo). Antes de eso, cualquier branding activo
//     es optimista.
//
// Autoridad de CUSTOM_BRANDING: exclusivamente server-side, vía
// `organization.branding.enabled` (ya resuelto por
// isFeatureAvailable(organization, PremiumFeature.CUSTOM_BRANDING) en
// getMyOrganizationService). Este Context NUNCA decide por `organization.plan`
// ni por el cache — el cache sólo alimenta el primer render, siempre se
// reconcilia contra el server.
// `loading: false` / `confirmed: true` por default (sin Provider ancestro,
// ej. Developer) a propósito — significa "no aplica ningún bootstrap acá",
// nunca "todavía cargando". Si el default fuera `loading: true`/
// `confirmed: false`, Developer (que nunca monta el Provider) entraría en
// el estado "cold start" de AppShell.jsx para siempre.
const OrganizationThemeContext = createContext({
  organization: null,
  visualBranding: null,
  brandingEnabled: false,
  themeStyle: undefined,
  loading: false,
  confirmed: true,
  applyBrandingUpdate: () => {},
});

export function OrganizationThemeProvider({ children }) {
  const { getToken, userId } = useAuth();
  const [organization, setOrganization] = useState(null);
  const [visualBranding, setVisualBranding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  // Bootstrap optimista: en cuanto Clerk resuelve `userId` (local, sin red
  // — mucho antes que cualquier fetch propio), se hidrata `visualBranding`
  // desde el cache si es válido. Esto NO marca `confirmed` ni popula
  // `organization` — es sólo un valor de partida para el primer render.
  useEffect(() => {
    if (!userId) return;
    const cached = readOrganizationThemeCache(userId);
    if (cached) {
      setVisualBranding({
        logo: cached.logo,
        primaryColor: cached.brandPrimaryColor,
        secondaryColor: cached.brandSecondaryColor,
        enabled: cached.brandingEnabled,
      });
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { organization: org } = await apiFetch("/api/organizations/me", { token });
        if (cancelled) return;

        setOrganization(org || null);

        // Reconciliación — el server SIEMPRE gana. Casos A/B/C del diseño:
        // A) branding.enabled true → cache/estado visual se reemplaza por
        //    los datos reales (sean iguales o no al cache previo).
        // B) branding.enabled false → cache se limpia, visualBranding cae
        //    a "sin branding" — nunca se borra nada en DB, sólo el cache
        //    local.
        // C) organizationId del server distinto al del cache: al
        //    reemplazar visualBranding directo con los datos del server
        //    (nunca hacemos merge), un organizationId distinto no puede
        //    dejar campos mezclados de dos Organizations.
        if (org?.branding?.enabled) {
          writeOrganizationThemeCache(userId, {
            organizationId: org.id,
            brandingEnabled: true,
            logo: org.logo ?? null,
            brandPrimaryColor: org.brandPrimaryColor ?? null,
            brandSecondaryColor: org.brandSecondaryColor ?? null,
          });
          setVisualBranding({
            logo: org.logo ?? null,
            primaryColor: org.brandPrimaryColor ?? null,
            secondaryColor: org.brandSecondaryColor ?? null,
            enabled: true,
          });
        } else {
          clearOrganizationThemeCache(userId);
          setVisualBranding(null);
        }
      } catch (err) {
        console.error("OrganizationThemeProvider: no se pudo cargar la organización", err);
        // Caso D — fetch falla: NUNCA se convierte en un downgrade
        // ficticio. Si ya había un `visualBranding` optimista (del cache),
        // se conserva tal cual; si no había nada, se mantiene el fallback
        // neutro ya vigente (visualBranding sigue null).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Llamado por OrganizationBrandingCard justo después de un PATCH exitoso
  // — actualización INMEDIATA del theme (logo/color) sin logout/login/
  // refresh, sin volver a pedir /me. También persiste el cache acá mismo
  // (punto único de escritura tras un guardado — evita duplicar esta
  // lógica en cada consumidor).
  const applyBrandingUpdate = useCallback(
    (partial) => {
      setOrganization((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...partial };
        if (userId && next.branding?.enabled) {
          writeOrganizationThemeCache(userId, {
            organizationId: next.id,
            brandingEnabled: true,
            logo: next.logo ?? null,
            brandPrimaryColor: next.brandPrimaryColor ?? null,
            brandSecondaryColor: next.brandSecondaryColor ?? null,
          });
        }
        setVisualBranding({
          logo: next.logo ?? null,
          primaryColor: next.brandPrimaryColor ?? null,
          secondaryColor: next.brandSecondaryColor ?? null,
          enabled: Boolean(next.branding?.enabled),
        });
        return next;
      });
    },
    [userId]
  );

  const brandingEnabled = Boolean(visualBranding?.enabled);
  const theme = useMemo(
    () =>
      brandingEnabled
        ? buildOrganizationTheme(visualBranding?.primaryColor, visualBranding?.secondaryColor)
        : null,
    [brandingEnabled, visualBranding?.primaryColor, visualBranding?.secondaryColor]
  );
  const themeStyle = theme ? toOrgThemeStyle(theme) : undefined;

  const value = useMemo(
    () => ({
      organization,
      visualBranding,
      brandingEnabled,
      themeStyle,
      loading,
      confirmed,
      applyBrandingUpdate,
    }),
    [organization, visualBranding, brandingEnabled, themeStyle, loading, confirmed, applyBrandingUpdate]
  );

  return <OrganizationThemeContext.Provider value={value}>{children}</OrganizationThemeContext.Provider>;
}

export function useOrganizationTheme() {
  return useContext(OrganizationThemeContext);
}
