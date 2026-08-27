import { apiFetch } from "./api.js";

// Modo Prelanzamiento — GET público, sin sesión: lo necesita cualquier
// visitante anónimo (o el propio frontend antes de que Clerk resuelva
// sesión) para decidir si muestra "Próximamente" o la superficie pública
// real. Ver backend/src/routes/publicLaunchStatus.routes.js.
export async function getPublicLaunchStatus() {
  return apiFetch("/api/public/launch-status");
}

// Developer > Configuración — GET/PUT /api/developer/launch-status.
// Exclusivo DEVELOPER (ver backend/src/routes/publicLaunchSettings.routes.js).
export async function getDeveloperLaunchStatus(token) {
  return apiFetch("/api/developer/launch-status", { token });
}

export async function updateDeveloperLaunchStatus(token, publicLaunchEnabled) {
  return apiFetch("/api/developer/launch-status", {
    token,
    method: "PUT",
    body: JSON.stringify({ publicLaunchEnabled }),
  });
}
