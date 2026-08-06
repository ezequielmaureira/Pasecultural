import { apiFetch } from "./api.js";

// Historial de Eventos — GET /api/events/archived, POST /:id/restore,
// POST /:id/duplicate (todos nuevos, ver backend/src/routes/event.routes.js).
export async function listArchivedEvents(token, { search } = {}) {
    const params = new URLSearchParams();
    if (search?.trim()) params.set("search", search.trim());
    const query = params.toString() ? `?${params.toString()}` : "";
    const { events } = await apiFetch(`/api/events/archived${query}`, { token });
    return events;
}

export async function restoreEvent(token, eventId) {
    const { event } = await apiFetch(`/api/events/${eventId}/restore`, { token, method: "POST" });
    return event;
}

export async function duplicateEvent(token, eventId) {
    const { event } = await apiFetch(`/api/events/${eventId}/duplicate`, { token, method: "POST" });
    return event;
}
