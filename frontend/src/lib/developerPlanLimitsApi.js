import { apiFetch } from "./api.js";

// Premium — Fase 2A — GET /api/developer/plan-limits. Exclusivo DEVELOPER
// (ver backend/src/routes/developerPlanLimits.routes.js). Devuelve
// { FREE: {...}, PREMIUM: {...} }.
export async function getDeveloperPlanLimits(token) {
    return apiFetch("/api/developer/plan-limits", { token });
}

// limits: { maxActiveEvents, maxCourtesiesPerEvent, maxScannersPerEvent }
// — cada uno un entero >= 0 o null ("sin límite"). Actualización PARCIAL:
// sólo se tocan las claves presentes (ver updatePlanLimitsService).
export async function updateDeveloperPlanLimits(token, plan, limits) {
    return apiFetch(`/api/developer/plan-limits/${plan}`, {
        token,
        method: "PATCH",
        body: JSON.stringify(limits),
    });
}
