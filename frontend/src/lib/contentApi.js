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

// Developer > Contenido — "¿Cómo funciona?" (pestañas asistentes/
// organizadores). GET/PUT /api/developer/content/how-it-works, exclusivo
// DEVELOPER.
export async function getHowItWorksContent(token) {
  return apiFetch("/api/developer/content/how-it-works", { token });
}

export async function updateHowItWorksContent(token, { attendees, organizers }) {
  return apiFetch("/api/developer/content/how-it-works", {
    token,
    method: "PUT",
    body: JSON.stringify({ attendees, organizers }),
  });
}

// Consumo público (página /como-funciona) — sin auth.
export async function getPublicHowItWorksContent() {
  return apiFetch("/api/content/how-it-works");
}
