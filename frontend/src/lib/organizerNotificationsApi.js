import { apiFetch } from "./api.js";

// Dashboard Organizador > Configuración > Notificaciones.
export async function getOrganizerNotificationSettings(token) {
    return apiFetch("/api/organizer/notification-settings", { token });
}

export async function updateOrganizerNotificationSettings(token, settings) {
    return apiFetch("/api/organizer/notification-settings", {
        token,
        method: "PUT",
        body: JSON.stringify(settings),
    });
}
