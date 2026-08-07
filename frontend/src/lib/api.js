const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
export const DEFAULT_TIMEOUT_MS = 20000;

const TIMEOUT_MESSAGE = "La operación está tardando más de lo esperado. Probá de nuevo en unos segundos.";
const NETWORK_ERROR_MESSAGE = "No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.";

// Cada fetch de la app pasa por acá: si el servidor no responde en
// DEFAULT_TIMEOUT_MS se aborta solo, en vez de dejar un botón en
// "Guardando..."/"Cargando..." colgado para siempre. Los errores de red
// crudos del navegador (ej. "Failed to fetch") tampoco llegan tal cual al
// usuario, se traducen a un mensaje amigable.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      const error = new Error(TIMEOUT_MESSAGE);
      error.isTimeout = true;
      throw error;
    }
    const error = new Error(NETWORK_ERROR_MESSAGE);
    error.isNetworkError = true;
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiFetch(path, { token, timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const res = await fetchWithTimeout(
    `${API_URL}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    },
    timeoutMs
  );

  if (!res.ok) {
    let message = `Error ${res.status} al llamar ${path}`;
    let code;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
      code = body?.error?.code;
    } catch {
      // respuesta sin body JSON, se mantiene el mensaje genérico
    }
    const error = new Error(message);
    error.status = res.status;
    // Código estable de ErrorCatalog (ej. "SCANNER_NOT_AUTHORIZED") para
    // cuando un caller necesita distinguir el motivo exacto, no sólo
    // mostrar el mensaje — `undefined` si el backend no lo mandó.
    error.code = code;
    throw error;
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

// Para respuestas binarias (ej. descarga de PDF) — apiFetch asume JSON
// siempre, así que esta variante hermana lee el cuerpo como Blob en vez de
// hacer res.json(). El manejo de timeout/error de red y de errores HTTP con
// body JSON (el backend sigue devolviendo JSON en los errores) es el mismo
// que apiFetch, para no duplicar esa lógica. `token` opcional: los primeros
// usos (recuperación de compra por publicRecoveryToken) no lo necesitaban,
// por eso no existía — un caller autenticado (ej. courtesyApi.js) lo pasa
// igual que apiFetch.
export async function apiFetchBlob(path, { token, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetchWithTimeout(
    `${API_URL}${path}`,
    { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
    timeoutMs
  );

  if (!res.ok) {
    let message = `Error ${res.status} al llamar ${path}`;
    let code;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
      code = body?.error?.code;
    } catch {
      // respuesta sin body JSON, se mantiene el mensaje genérico
    }
    const error = new Error(message);
    error.status = res.status;
    error.code = code;
    throw error;
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  return { blob, filename: match ? match[1] : "descarga.pdf" };
}

export async function apiUpload(path, { token, file, method = "POST", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetchWithTimeout(
    `${API_URL}${path}`,
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    },
    timeoutMs
  );

  if (!res.ok) {
    let message = `Error ${res.status} al subir el archivo`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      // respuesta sin body JSON, se mantiene el mensaje genérico
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  return res.json();
}
