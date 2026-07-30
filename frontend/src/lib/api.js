const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 20000;

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

  if (res.status === 204) {
    return null;
  }

  return res.json();
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
