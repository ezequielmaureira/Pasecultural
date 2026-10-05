import { apiFetch } from "./api.js";

// Historial de Eventos — GET /api/events/archived, POST /:id/duplicate
// (ver backend/src/routes/event.routes.js). No existe "restaurar": un
// evento archivado nunca vuelve a Eventos vigentes (ver el informe de la
// ronda "Retiro de Restaurar Evento") — duplicar es el único camino para
// reutilizar su configuración.
export async function listArchivedEvents(token, { search } = {}) {
    const params = new URLSearchParams();
    if (search?.trim()) params.set("search", search.trim());
    const query = params.toString() ? `?${params.toString()}` : "";
    const { events } = await apiFetch(`/api/events/archived${query}`, { token });
    return events;
}

export async function duplicateEvent(token, eventId) {
    const { event } = await apiFetch(`/api/events/${eventId}/duplicate`, { token, method: "POST" });
    return event;
}

// "Informe final" de solo lectura de un evento ya archivado — GET
// /api/events/archived/:eventId/summary (archivedEventSummary.service.js).
// Devuelve { event, functions, functionStats, sales, tickets, scanners }.
export async function getArchivedEventSummary(token, eventId) {
    return apiFetch(`/api/events/archived/${eventId}/summary`, { token });
}
