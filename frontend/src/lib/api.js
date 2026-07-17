const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export async function apiFetch(path, { token, ...options } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

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

export async function apiUpload(path, { token, file, method = "POST" } = {}) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

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
