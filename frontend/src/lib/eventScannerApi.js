import { apiFetch } from "./api.js";

export async function listEventScanners(token, eventId) {
    const { scanners } = await apiFetch(`/api/events/${eventId}/scanners`, { token });
    return scanners;
}

export async function addEventScanner(token, eventId, email) {
    const { scanner } = await apiFetch(`/api/events/${eventId}/scanners`, {
        token,
        method: "POST",
        body: JSON.stringify({ email }),
    });
    return scanner;
}

export async function removeEventScanner(token, eventId, userId) {
    await apiFetch(`/api/events/${eventId}/scanners/${userId}`, { token, method: "DELETE" });
}
