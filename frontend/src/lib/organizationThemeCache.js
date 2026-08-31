// Organization Theme Bootstrap — Premium Fase 2D.1.2. Cache visual PURAMENTE
// optimista para eliminar el flash de tema estándar al recargar el
// dashboard organizer. NUNCA es autoridad: el server (isFeatureAvailable +
// GET /api/organizations/me) sigue siendo la única fuente de verdad para
// cualquier decisión de plan/permisos/features — esto sólo decide qué
// colores pintar en el primer render, antes de que esa respuesta llegue.
//
// Clave por clerkId (nunca global, nunca por organizationId): el
// organizationId es justamente el dato que no conocemos hasta que responde
// el server, así que no puede ser la clave de lectura. Clerk resuelve su
// propia sesión localmente (sin red) mucho antes que cualquiera de nuestros
// fetches — es la única identidad estable disponible en el momento del
// bootstrap.

const CACHE_KEY_PREFIX = "pc:org-theme:";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h — higiene, nunca seguridad.

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function isNullableHexColor(value) {
  return value === null || (typeof value === "string" && HEX_COLOR_RE.test(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

// Toda la superficie de contacto con localStorage pasa por acá — si el
// storage no existe, está bloqueado, o tira por cuota excedida, se trata
// exactamente igual que "no hay cache": nunca rompe el render.
function safeGetItem(key) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // Quota excedida / storage bloqueado / modo privado — la app sigue
    // funcionando sin cache, nunca hay que propagar este error.
  }
}

function safeRemoveItem(key) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    // Igual criterio que safeSetItem.
  }
}

function cacheKey(clerkId) {
  return `${CACHE_KEY_PREFIX}${clerkId}`;
}

// Validación estructural completa — nunca confía en el JSON parseado tal
// cual. `clerkId` acá es el que se usó para LEER (la clave ya lo aisló),
// pero se revalida también el campo interno: si no coincide exactamente,
// se descarta (defensa en profundidad, nunca debería divergir de la key).
function isValidCacheEntry(value, clerkId) {
  if (!value || typeof value !== "object") return false;
  if (value.clerkId !== clerkId) return false;
  if (!isNonEmptyString(value.organizationId)) return false;
  if (typeof value.brandingEnabled !== "boolean") return false;
  if (value.logo !== null && typeof value.logo !== "string") return false;
  if (!isNullableHexColor(value.brandPrimaryColor)) return false;
  if (!isNullableHexColor(value.brandSecondaryColor)) return false;
  if (typeof value.cachedAt !== "number" || !Number.isFinite(value.cachedAt)) return false;
  return true;
}

// Lee el cache visual de `clerkId` — devuelve `null` ante CUALQUIER duda
// (ausente, corrupto, estructura inválida, clerkId no coincide, vencido).
// Nunca lanza.
export function readOrganizationThemeCache(clerkId) {
  if (!isNonEmptyString(clerkId)) return null;

  const raw = safeGetItem(cacheKey(clerkId));
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isValidCacheEntry(parsed, clerkId)) return null;

  if (Date.now() - parsed.cachedAt > TTL_MS) {
    // Vencido — se ignora y se limpia (higiene, no seguridad).
    safeRemoveItem(cacheKey(clerkId));
    return null;
  }

  return parsed;
}

// Escribe el cache visual de `clerkId`. `cachedAt` se estampa acá mismo
// (nunca lo decide el caller) para que siempre refleje el momento real de
// la escritura. Campos fuera de esta whitelist NUNCA se persisten, aunque
// el caller los pase por error — sólo lo estrictamente visual.
export function writeOrganizationThemeCache(clerkId, data) {
  if (!isNonEmptyString(clerkId)) return;
  if (!data || !isNonEmptyString(data.organizationId)) return;
  if (typeof data.brandingEnabled !== "boolean") return;
  if (!isNullableHexColor(data.brandPrimaryColor ?? null)) return;
  if (!isNullableHexColor(data.brandSecondaryColor ?? null)) return;

  const entry = {
    clerkId,
    organizationId: data.organizationId,
    brandingEnabled: data.brandingEnabled,
    logo: data.logo ?? null,
    brandPrimaryColor: data.brandPrimaryColor ?? null,
    brandSecondaryColor: data.brandSecondaryColor ?? null,
    cachedAt: Date.now(),
  };

  try {
    safeSetItem(cacheKey(clerkId), JSON.stringify(entry));
  } catch {
    // JSON.stringify no debería fallar con este shape, pero por las dudas
    // nunca se propaga — perder el cache es inofensivo.
  }
}

export function clearOrganizationThemeCache(clerkId) {
  if (!isNonEmptyString(clerkId)) return;
  safeRemoveItem(cacheKey(clerkId));
}
