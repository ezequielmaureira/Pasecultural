import { apiFetch } from "./api.js";

// Developer > QA / Checklist — GET /api/developer/qa-checklist. Exclusivo
// DEVELOPER (ver backend/src/routes/developerQaChecklist.routes.js).
// Devuelve { items: [...], stats: { global, byRole } }.
export async function getQaChecklist(token) {
  return apiFetch("/api/developer/qa-checklist", { token });
}

// changes: actualización PARCIAL — { checked?: true|false, note?: string|null },
// al menos una de las dos. JSON.stringify ya omite claves en undefined, así
// que un caller que sólo manda `{ note: "..." }` nunca serializa `checked`.
// Devuelve { item }.
export async function updateQaChecklistItem(token, key, changes) {
  return apiFetch(`/api/developer/qa-checklist/${encodeURIComponent(key)}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}
