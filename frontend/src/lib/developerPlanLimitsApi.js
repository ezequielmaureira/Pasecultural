import { apiFetch } from "./api.js";

// Developer > Planes — GET /api/developer/plan-limits. Exclusivo DEVELOPER
// (ver backend/src/routes/developerPlanLimits.routes.js). Devuelve
// { FREE: {...}, PREMIUM: {...} }.
export async function getDeveloperPlanLimits(token) {
    return apiFetch("/api/developer/plan-limits", { token });
}

// limits: subconjunto de { maxActiveEvents, maxActiveScanners,
// maxTicketsPerEvent, publicOrgPageEnabled, whatsappEventCreationEnabled,
// featuredEligible } — los 3 numéricos son un entero >= 0 o null ("sin
// límite"), los 3 booleanos son true/false. Actualización PARCIAL: sólo se
// tocan las claves presentes (ver updatePlanLimitsService).
export async function updateDeveloperPlanLimits(token, plan, limits) {
    return apiFetch(`/api/developer/plan-limits/${plan}`, {
        token,
        method: "PATCH",
        body: JSON.stringify(limits),
    });
}
