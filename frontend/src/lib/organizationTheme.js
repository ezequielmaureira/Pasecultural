// Organization Theme — Premium Fase 2D.1. Función pura: recibe la semilla
// (brandPrimaryColor, un #RRGGBB) y devuelve un set chico de tokens
// derivados en HSL. Nunca escribe en :root/document.documentElement/body —
// el caller es responsable de aplicar el resultado como CSS custom
// properties en un wrapper React scoped (ver toOrgThemeStyle). Sin
// dependencias externas: manipulación de color casera, a propósito, para no
// sumar una librería sólo para esto.

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function hexToRgb(hex) {
  const match = HEX_RE.exec(hex);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
  }
  return { h: h * 60, s, l };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hsl(h, s, l) {
  return `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 100)}%)`;
}

function hsla(h, s, l, a) {
  return `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 100)}% / ${clamp(a, 0, 1)})`;
}

// WCAG relative luminance sobre el color semilla tal cual (no el derivado):
// decide si un texto puesto ENCIMA de --org-primary debe ser claro u oscuro.
function relativeLuminance({ r, g, b }) {
  const channel = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Fallback neutro (gris azulado, el mismo espíritu que el tema estándar de
// Smarticket) para semillas inválidas o ausentes — nunca undefined/NaN en
// los tokens devueltos.
const FALLBACK_HSL = { h: 258, s: 0.6, l: 0.56 }; // ~violeta actual del tema

// Tokens conceptuales — background/surface mantienen la estética oscura de
// Smarticket (luminancia baja fija) y sólo adoptan el matiz de la semilla,
// nunca su luminancia/saturación cruda: así un color muy claro o muy
// saturado no puede "blanquear" ni saturar en exceso el fondo.
export function buildOrganizationTheme(brandPrimaryColor) {
  const rgb = hexToRgb(brandPrimaryColor || "");
  const seed = rgb ? rgbToHsl(rgb) : FALLBACK_HSL;

  // Primary/accent: hue de la semilla, saturación acotada, luminancia
  // clampeada a un rango donde el color sigue siendo legible como fondo de
  // botón y como acento sobre fondo oscuro (ni casi negro ni casi blanco).
  const primaryL = clamp(seed.l, 0.4, 0.62);
  const primaryS = clamp(seed.s, 0.35, 0.85);

  const primary = hsl(seed.h, primaryS, primaryL);
  const hover = hsl(seed.h, primaryS, clamp(primaryL - 0.08, 0.28, 0.7));
  const accent = primary;

  const background = hsl(seed.h, clamp(seed.s, 0.25, 0.5), 0.03);
  const surface = hsl(seed.h, clamp(seed.s, 0.2, 0.45), 0.07);
  const surfaceAlt = hsl(seed.h, clamp(seed.s, 0.2, 0.45), 0.1);
  const border = hsla(seed.h, clamp(seed.s, 0.2, 0.5), 0.4, 0.35);

  const textPrimary = "hsl(0 0% 98%)";
  const textMuted = hsl(seed.h, 0.12, 0.68);

  // Contraste: se calcula sobre el RGB real de la semilla (no sobre el HSL
  // clampeado) — es el color que efectivamente va a estar detrás del texto
  // en botones/acentos "on-primary".
  const luminance = rgb ? relativeLuminance(rgb) : relativeLuminance({ r: 124, g: 58, b: 237 });
  const textOnPrimary = luminance > 0.5 ? "hsl(222 47% 8%)" : "hsl(0 0% 100%)";

  return {
    primary,
    background,
    surface,
    surfaceAlt,
    border,
    accent,
    hover,
    textPrimary,
    textMuted,
    textOnPrimary,
  };
}

// CSS custom properties scoped — para usar como prop `style` de un wrapper
// React. Nunca debe aplicarse a document.documentElement/body: sólo a un
// nodo puntual, de forma que la cascada CSS limite el alcance a sus
// descendientes y desaparezca solo al desmontar ese nodo.
export function toOrgThemeStyle(theme) {
  return {
    "--org-primary": theme.primary,
    "--org-bg": theme.background,
    "--org-surface": theme.surface,
    "--org-surface-alt": theme.surfaceAlt,
    "--org-border": theme.border,
    "--org-accent": theme.accent,
    "--org-hover": theme.hover,
    "--org-text-primary": theme.textPrimary,
    "--org-text-muted": theme.textMuted,
    "--org-text-on-primary": theme.textOnPrimary,
    // Retro-compatibilidad con el único uso previo (OrganizationProfile,
    // Fase 2D) — mismo valor que --org-primary, se mantiene para no romper
    // el arbitrary value hover:border-[var(--brand-color,...)] ya en uso.
    "--brand-color": theme.primary,
  };
}

// Clase que activa los overrides CSS scoped (ver styles/index.css,
// bloque `.org-theme`) — null/undefined cuando no hay branding autorizado,
// para que el wrapper caiga exactamente en el tema estándar sin condicionar
// cada consumidor.
export const ORG_THEME_CLASS = "org-theme";
