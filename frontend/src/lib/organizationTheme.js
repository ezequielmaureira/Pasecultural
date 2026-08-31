// Organization Theme — Premium Fase 2D.1.1 (dos colores reales). Función
// pura: recibe primary/secondary (#RRGGBB) y devuelve tokens de interfaz.
// Nunca escribe en :root/document.documentElement/body — el caller aplica
// el resultado como CSS custom properties en un wrapper React scoped (ver
// toOrgThemeStyle). Sin dependencias externas.
//
// Corrección post-2D.1: la versión anterior clampeaba background/surface a
// una luminancia fija muy baja (3%/7%/10%), descartando la luminosidad real
// de la semilla — por eso un color brillante como #BBFF00 terminaba
// prácticamente negro. Acá primary/secondary se conservan TAL CUAL fueron
// elegidos (nunca se les recorta luminancia/saturación); sólo los tokens
// AUXILIARES (background/surface/border/hover/muted) se derivan mezclando
// ambos colores reales entre sí o con su propio color de contraste — nunca
// sustituyendo primary/secondary por otra cosa.

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const match = HEX_RE.exec(value);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const int = parseInt(normalized.slice(1), 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex({ r, g, b }) {
  const toHex = (c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Mezcla lineal de canales RGB — `ratio` es cuánto de `hexB` se mezcla
// dentro de `hexA` (0 = hexA puro, 1 = hexB puro). Determinístico, sin
// gamma-correction (no hace falta precisión fotométrica para tokens de UI).
function mixHex(hexA, hexB, ratio) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return a ? rgbToHex(a) : b ? rgbToHex(b) : "#000000";
  const t = Math.min(1, Math.max(0, ratio));
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(1, Math.max(0, alpha))})`;
}

// WCAG relative luminance — decide si un texto puesto ENCIMA de un color
// dado debe ser claro u oscuro. Pura, no asume nada sobre el color de
// entrada (no hardcodea "primary es claro"/"secondary es oscuro").
function relativeLuminance({ r, g, b }) {
  const channel = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const LIGHT_TEXT = "#F8FAFC";
const DARK_TEXT = "#0B1120";

// Función pura exportada — determina automáticamente si un color de fondo
// necesita texto claro u oscuro encima, por luminancia real (nunca casos
// hardcodeados). Ejemplos: #BBFF00 → oscuro, #000000 → claro, #0000FF →
// claro, #FFFFFF → oscuro.
export function getContrastText(hexColor) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return LIGHT_TEXT;
  return relativeLuminance(rgb) > 0.5 ? DARK_TEXT : LIGHT_TEXT;
}

// Semilla de fallback (mismo violeta que ya era el tema estándar) — sólo
// para cuando no hay NINGÚN color configurado (defensivo; CUSTOM_BRANDING
// habilitado sin colores no debería ocurrir en la práctica).
const FALLBACK_PRIMARY = "#7C3AED";

// Fase 2D.1.1: organizaciones que sólo configuraron un color (todas las de
// 2D.1) no deben romperse. Si sólo hay primary, se deriva un secondary
// ESTRUCTURAL oscuro mezclando el propio primary hacia negro — conserva la
// relación de matiz con la marca en vez de un negro genérico, y reproduce
// la estética oscura que esas organizaciones ya tenían, SIN tocar el
// primary en sí (que sigue siendo el color real elegido).
function deriveSecondaryFromPrimary(primaryHex) {
  return mixHex(primaryHex, "#000000", 0.8);
}

export function buildOrganizationTheme(primaryColorInput, secondaryColorInput) {
  const primaryHex = normalizeHex(primaryColorInput) || FALLBACK_PRIMARY;
  const secondaryHex =
    normalizeHex(secondaryColorInput) || deriveSecondaryFromPrimary(primaryHex);

  const onPrimary = getContrastText(primaryHex);
  const onSecondary = getContrastText(secondaryHex);

  // Estructura (fondo/superficies) derivada predominantemente de secondary,
  // con un 15-22% de mezcla hacia primary — así ambos colores quedan
  // presentes en la composición general sin que ninguno "gane" del todo.
  const background = mixHex(secondaryHex, primaryHex, 0.15);
  const surface = mixHex(secondaryHex, primaryHex, 0.08);
  const surfaceAlt = mixHex(secondaryHex, primaryHex, 0.22);

  // Separadores (borde/muted) derivados del color de CONTRASTE de secondary
  // (no de primary/secondary directo) — así siguen siendo visibles incluso
  // en el caso límite primary===secondary o colores casi idénticos (ver
  // combinaciones difíciles): onSecondary siempre contrasta, por
  // definición, contra background/surface (que están basados en secondary).
  const border = rgbaFromHex(onSecondary, 0.18);
  const text = onSecondary;
  const muted = mixHex(onSecondary, background, 0.45);

  // Hover: primary desplazado hacia su propio color de contraste — cambia
  // de forma visible al pasar el mouse incluso en combinaciones extremas
  // (primary blanco sobre fondo blanco, etc.), sin dejar de ser
  // reconociblemente "primary".
  const hover = mixHex(primaryHex, onPrimary, 0.18);

  return {
    primary: primaryHex,
    secondary: secondaryHex,
    onPrimary,
    onSecondary,
    background,
    surface,
    surfaceAlt,
    border,
    accent: primaryHex,
    hover,
    text,
    muted,
  };
}

// CSS custom properties scoped — para usar como prop `style` de un wrapper
// React. Nunca debe aplicarse a document.documentElement/body: sólo a un
// nodo puntual, de forma que la cascada CSS limite el alcance a sus
// descendientes y desaparezca solo al desmontar ese nodo.
export function toOrgThemeStyle(theme) {
  return {
    "--org-primary": theme.primary,
    "--org-secondary": theme.secondary,
    "--org-on-primary": theme.onPrimary,
    "--org-on-secondary": theme.onSecondary,
    "--org-background": theme.background,
    "--org-surface": theme.surface,
    "--org-surface-alt": theme.surfaceAlt,
    "--org-border": theme.border,
    "--org-accent": theme.accent,
    "--org-hover": theme.hover,
    "--org-text": theme.text,
    "--org-muted": theme.muted,
    // Retro-compatibilidad — mismos valores, nombres previos a 2D.1.1,
    // usados por el único arbitrary-value Tailwind que ya existía
    // (OrganizationProfile.jsx) y por lecturas externas que puedan quedar.
    "--brand-color": theme.primary,
    "--org-text-on-primary": theme.onPrimary,
    "--org-text-primary": theme.text,
    "--org-text-muted": theme.muted,
  };
}

// Clase que activa los overrides CSS scoped (ver styles/index.css,
// bloque `.org-theme`) — null/undefined cuando no hay branding autorizado,
// para que el wrapper caiga exactamente en el tema estándar sin condicionar
// cada consumidor.
export const ORG_THEME_CLASS = "org-theme";
