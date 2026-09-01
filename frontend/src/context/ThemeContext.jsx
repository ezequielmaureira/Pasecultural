import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Selector UNIVERSAL de apariencia claro/oscuro — completamente ajeno a
// Organization/plan/rol. Es una preferencia del NAVEGADOR, no de la sesión:
// nunca depende de Clerk, nunca pega al backend, nunca persiste en la base.
//
// Deliberadamente NO reutiliza (ni por nombre ni por arquitectura) nada del
// sistema de branding de Organization retirado anteriormente
// (OrganizationTheme/PublicBrandingContext/useOrganizationThemeProps/
// CUSTOM_BRANDING) — esto es apariencia GLOBAL del producto, no
// personalización por Organization.
const THEME_STORAGE_KEY = "smarticket-theme";
const VALID_THEMES = new Set(["light", "dark"]);

const ThemeContext = createContext(null);

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.has(stored) ? stored : null;
  } catch {
    // localStorage inaccesible (modo privado estricto, etc.) — se cae al
    // comportamiento visual actual (oscuro), nunca se rompe el render.
    return null;
  }
}

function applyThemeClass(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
}

export function ThemeProvider({ children }) {
  // Lazy initializer: síncrono, sin flicker de React (el flash de HTML
  // crudo entre el primer paint y el mount de React ya lo evita el script
  // inline de index.html, que lee la misma clave y la misma clase).
  const [theme, setTheme] = useState(() => readStoredTheme() ?? "dark");

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Sin persistencia posible: el toggle sigue funcionando en memoria
        // para el resto de esta sesión de navegación, sólo no sobrevive a
        // un reload — degradación aceptable, nunca un error visible.
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme debe usarse dentro de ThemeProvider");
  }
  return ctx;
}
