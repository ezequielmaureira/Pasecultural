import { apiFetch } from "./api.js";

// GET /api/developer/dashboard — único endpoint agregado, platform-wide,
// exclusivo DEVELOPER (ver backend/src/services/developerDashboard.service.js).
// Devuelve { kpis, upcomingEvents, recentActivity } tal cual, sin envoltorio
// que desarmar (a diferencia de listados que vienen como { events }/{ tickets }).
export async function getDeveloperDashboard(token) {
    return apiFetch("/api/developer/dashboard", { token });
}
