import { apiFetch } from "./api.js";

// Developer > QA / Checklist — GET /api/developer/qa-checklist. Exclusivo
// DEVELOPER (ver backend/src/routes/developerQaChecklist.routes.js).
// Devuelve { items: [...], stats: { global, byRole } }.
export async function getQaChecklist(token) {
  return apiFetch("/api/developer/qa-checklist", { token });
}

// checked: true|false, explícito. Devuelve { item }.
export async function updateQaChecklistItem(token, key, checked) {
  return apiFetch(`/api/developer/qa-checklist/${encodeURIComponent(key)}`, {
    token,
    method: "PATCH",
    body: JSON.stringify({ checked }),
  });
}
