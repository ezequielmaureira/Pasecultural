import { apiFetch } from "./api.js";

// Panel Developer → "Base de Datos" — sólo DEVELOPER, sólo fuera de
// producción (el backend corta con 403 en cualquier otro caso, ver
// backend/src/middlewares/requireDevelopmentEnv.js).
export async function getDevDatabaseStats(token) {
    const { stats } = await apiFetch("/api/dev/stats", { token });
    return stats;
}

// `confirm` tiene que ser exactamente la frase que el backend espera — ver
// RESET_CONFIRMATION_PHRASE en devTools.service.js. Es la tercera capa de
// la doble confirmación (las primeras dos son los dos ConfirmDialog de la
// pantalla).
export async function resetDevDatabase(token, confirm) {
    const { deleted } = await apiFetch("/api/dev/reset", {
        token,
        method: "POST",
        body: JSON.stringify({ confirm }),
    });
    return deleted;
}

export async function createDemoEvent(token) {
    const { event } = await apiFetch("/api/dev/demo-event", { token, method: "POST" });
    return event;
}
