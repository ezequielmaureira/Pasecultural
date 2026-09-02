import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useBackendUser } from "./AuthContext.jsx";

// Apariencia AUTOMÁTICA de Smarticket — YA NO es una preferencia manual del
// usuario (no hay toggle, no hay localStorage de "elección"). El modo se
// DERIVA de dos cosas, nunca elegidas a mano:
//
//   1) rol autenticado: ORGANIZER siempre ve TODO Smarticket en claro.
//   2) "Organization Experience": un visitante/comprador que entró a
//      /organizacion/:slug y sigue navegando dentro de ese recorrido
//      (detalle de evento, checkout) ve esa parte en claro — apenas vuelve
//      a una sección GENERAL de Smarticket, vuelve a oscuro.
//
// Deliberadamente NO reutiliza (ni por nombre ni por arquitectura) nada del
// sistema de branding de Organization retirado anteriormente
// (OrganizationTheme/PublicBrandingContext/useOrganizationThemeProps/
// CUSTOM_BRANDING): esto no es personalización por Organization ni depende
// de su plan — TODA Organization Experience se ve exactamente igual, y
// TODO Organizer se ve exactamente igual.
const ORG_EXPERIENCE_STORAGE_KEY = "smarticket-organization-experience";

// Rutas que representan la CONTINUACIÓN de un recorrido ya iniciado en
// /organizacion/:slug (nunca lo inician por sí mismas: si se entra acá
// directo, sin haber pasado antes por una Organization, no hay experiencia
// que continuar). No alcanza con mirar el pathname de ESTAS rutas para
// decidir el theme — por eso existe el estado persistido: el mismo
// EventDetail (/evento/:slug) debe verse oscuro si se llegó desde /eventos
// general, y claro si se llegó desde la página de la Organization.
function isOrganizationContinuationPath(pathname) {
  return pathname.startsWith("/evento/") || pathname === "/comprar";
}

function readStoredOrganizationExperience() {
  try {
    return sessionStorage.getItem(ORG_EXPERIENCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredOrganizationExperience(slug) {
  try {
    if (slug) sessionStorage.setItem(ORG_EXPERIENCE_STORAGE_KEY, slug);
    else sessionStorage.removeItem(ORG_EXPERIENCE_STORAGE_KEY);
  } catch {
    // sessionStorage inaccesible: la experiencia sigue funcionando en
    // memoria para esta sesión de navegación, sólo no sobrevive a un F5.
  }
}

function applyThemeClass(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const location = useLocation();
  const { backendUser } = useBackendUser();
  const isOrganizer = backendUser?.role?.toLowerCase() === "organizer";

  // Sólo guarda el SLUG de la Organization que se está recorriendo — nunca
  // branding/colores/plan/datos completos. `null` = no hay ninguna
  // Organization Experience activa. Lazy initializer: lee sessionStorage
  // una sola vez, de forma síncrona (sin flicker de React).
  const [organizationExperienceSlug, setOrganizationExperienceSlug] = useState(
    () => readStoredOrganizationExperience()
  );

  useEffect(() => {
    const { pathname } = location;
    const orgSlugMatch = pathname.match(/^\/organizacion\/([^/]+)/);

    if (orgSlugMatch) {
      // Entrando (o ya estando) en la página pública de una Organization —
      // siempre arranca/actualiza la experiencia a ESTA Organization, sin
      // pasar por oscuro entre una y otra si se navega directo de una a otra.
      const slug = orgSlugMatch[1];
      setOrganizationExperienceSlug(slug);
      writeStoredOrganizationExperience(slug);
      return;
    }

    if (isOrganizationContinuationPath(pathname)) {
      // Detalle de evento o checkout: NUNCA decide nada por sí solo — sólo
      // preserva la experiencia que ya estuviera activa (o sigue sin
      // ninguna, si nunca se pasó por una Organization).
      return;
    }

    // Cualquier otra pantalla (Home, /eventos general, login, paneles,
    // legales, etc.) es navegación GENERAL — abandona la Organization
    // Experience si había una activa. Nunca queda "light" pegado.
    if (organizationExperienceSlug !== null) {
      setOrganizationExperienceSlug(null);
      writeStoredOrganizationExperience(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const theme = isOrganizer || organizationExperienceSlug !== null ? "light" : "dark";

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const value = useMemo(() => ({ theme }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme debe usarse dentro de ThemeProvider");
  }
  return ctx;
}
