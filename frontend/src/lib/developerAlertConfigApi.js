import { apiFetch } from "./api.js";

// Alertas Developer — GET/PUT /api/developer/alert-config. Exclusivo
// DEVELOPER (ver backend/src/routes/developerAlertConfig.routes.js).
export async function getDeveloperAlertConfig(token) {
    return apiFetch("/api/developer/alert-config", { token });
}

// config: { highTicketPriceThreshold, highSaleQuantityThreshold,
// eventsWindowCount, eventsWindowHours, salesVolumeWindowCount,
// salesVolumeWindowMinutes, refundsVolumeWindowCount,
// refundsVolumeWindowHours, alertCooldownMinutes } — reemplaza la
// configuración COMPLETA de forma atómica (ver replaceDeveloperAlertConfigService).
export async function updateDeveloperAlertConfig(token, config) {
    return apiFetch("/api/developer/alert-config", {
        token,
        method: "PUT",
        body: JSON.stringify(config),
    });
}
