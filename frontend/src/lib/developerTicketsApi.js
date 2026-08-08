import { apiFetch } from "./api.js";

// GET /api/developer/tickets — listado platform-wide, paginado y
// filtrable, exclusivo DEVELOPER (ver backend/src/services/developerTickets.service.js).
// Mismo patrón que developerEventsApi.js: sólo se agregan al querystring
// los filtros presentes.
export async function listDeveloperTickets(token, { page, limit, search, organizationId, eventId, status, origin, deleted } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", page);
    if (limit) params.set("limit", limit);
    if (search?.trim()) params.set("search", search.trim());
    if (organizationId) params.set("organizationId", organizationId);
    if (eventId) params.set("eventId", eventId);
    if (status) params.set("status", status);
    if (origin) params.set("origin", origin);
    if (deleted) params.set("deleted", deleted);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch(`/api/developer/tickets${query}`, { token });
}

// GET /api/developer/tickets/:id — detalle de sólo lectura (PII + check-ins
// + auditoría), pedido bajo demanda al abrir el drawer.
export async function getDeveloperTicket(token, ticketId) {
    const { ticket } = await apiFetch(`/api/developer/tickets/${ticketId}`, { token });
    return ticket;
}

// GET /api/developer/events/options?organizationId=... — dropdown en
// cascada: sólo tiene sentido pedirlo con una organización ya elegida (el
// caller es responsable de no llamarlo sin organizationId).
export async function getDeveloperEventOptions(token, organizationId) {
    const { events } = await apiFetch(`/api/developer/events/options?organizationId=${encodeURIComponent(organizationId)}`, { token });
    return events;
}
