import { apiFetch } from "./api.js";

// Panel Developer → "Base de Datos" — sólo DEVELOPER, sólo fuera de
// producción (el backend corta con 403 en cualquier otro caso, ver
// backend/src/middlewares/requireDevelopmentEnv.js).
export async function getDevDatabaseStats(token) {
    const { stats } = await apiFetch("/api/dev/stats", { token });
    return stats;
}

export async function createDemoEvent(token) {
    const { event } = await apiFetch("/api/dev/demo-event", { token, method: "POST" });
    return event;
}
