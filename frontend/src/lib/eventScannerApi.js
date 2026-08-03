import { apiFetch } from "./api.js";

// Paso 1 del asistente ("¿para qué evento?") — eventos activos del
// organizador, sin depender de un eventId propio.
export async function listActiveEventsForScanner(token) {
    const { events } = await apiFetch("/api/events/scanner-events", { token });
    return events;
}

export async function listEventScanners(token, eventId) {
    const { scanners } = await apiFetch(`/api/events/${eventId}/scanners`, { token });
    return scanners;
}

// Paso 4: crea `quantity` invitaciones iguales para una puerta. Devuelve el
// lote completo (con invitationToken) para la pantalla de "compartir".
export async function createScannerInvitations(token, eventId, { gate, quantity }) {
    const { scanners } = await apiFetch(`/api/events/${eventId}/scanners`, {
        token,
        method: "POST",
        body: JSON.stringify({ gate, quantity }),
    });
    return scanners;
}

export async function updateScanner(token, eventId, scannerId, { name, gate }) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners/${scannerId}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ name, gate }),
    });
    return scanner;
}

export async function approveScanner(token, eventId, scannerId) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners/${scannerId}/approve`, { token, method: "POST" });
    return scanner;
}

export async function rejectScanner(token, eventId, scannerId) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners/${scannerId}/reject`, { token, method: "POST" });
    return scanner;
}

export async function disableScanner(token, eventId, scannerId) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners/${scannerId}/disable`, { token, method: "POST" });
    return scanner;
}

export async function reactivateScanner(token, eventId, scannerId) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners/${scannerId}/reactivate`, { token, method: "POST" });
    return scanner;
}

export async function revokeScannerInvitation(token, eventId, scannerId) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners/${scannerId}/revoke`, { token, method: "POST" });
    return scanner;
}

export async function regenerateScannerInvitation(token, eventId, scannerId) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners/${scannerId}/regenerate`, { token, method: "POST" });
    return scanner;
}

export async function deleteScanner(token, eventId, scannerId) {
    await apiFetch(`/api/events/${eventId}/scanners/${scannerId}`, { token, method: "DELETE" });
}
