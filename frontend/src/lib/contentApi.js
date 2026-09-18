import { apiFetch } from "./api.js";

// Developer > Contenido (V1 mínima) — GET/PUT
// /api/developer/content/fest-pass-intro. Exclusivo DEVELOPER (ver
// backend/src/routes/content.routes.js).
export async function getFestPassIntroContent(token) {
  return apiFetch("/api/developer/content/fest-pass-intro", { token });
}

export async function updateFestPassIntroContent(token, { imageUrl, active }) {
  return apiFetch("/api/developer/content/fest-pass-intro", {
    token,
    method: "PUT",
    body: JSON.stringify({ imageUrl, active }),
  });
}

// Consumo público (Organizer > Fest Pass) — sin auth. Ver
// backend/src/routes/content.public.routes.js.
export async function getPublicFestPassIntroContent() {
  return apiFetch("/api/content/fest-pass-intro");
}
