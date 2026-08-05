import { apiFetch } from "./api.js";

// Panel de organizador "Entradas" — mismo patrón que eventScannerApi.js
// (funciones finitas sobre apiFetch, token siempre primero). Los 5 POST/DELETE
// pegan a endpoints que ya existían (ticketAdmin.service.js/.controller.js,
// backend/src/routes/event.routes.js) — nada nuevo del lado servidor salvo
// el listado.

// GET /api/tickets/organizer — todos los tickets vendidos de todos los
// eventos del organizador, con búsqueda y filtro de estado server-side.
export async function listOrganizerTickets(token, { search, status } = {}) {
    const params = new URLSearchParams();
    if (search?.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    const query = params.toString() ? `?${params.toString()}` : "";
    const { tickets } = await apiFetch(`/api/tickets/organizer${query}`, { token });
    return tickets;
}

export async function cancelTicket(token, eventId, ticketId, { reason } = {}) {
    const { ticket } = await apiFetch(`/api/events/${eventId}/tickets/${ticketId}/cancel`, {
        token,
        method: "POST",
        body: JSON.stringify({ reason }),
    });
    return ticket;
}

// CANCELLED -> ACTIVE en el backend (ver ticketAdmin.service.js) — en esta
// pantalla el botón correspondiente se muestra con el label "Reactivar"
// para una entrada CANCELLED (ver OrganizerTickets.jsx).
export async function rehabilitateTicket(token, eventId, ticketId, { reason } = {}) {
    const { ticket } = await apiFetch(`/api/events/${eventId}/tickets/${ticketId}/rehabilitate`, {
        token,
        method: "POST",
        body: JSON.stringify({ reason }),
    });
    return ticket;
}

// USED -> ACTIVE en el backend — acá el botón correspondiente se muestra
// con el label "Rehabilitar" para una entrada USED (ver OrganizerTickets.jsx).
export async function reactivateTicket(token, eventId, ticketId, { reason } = {}) {
    const { ticket } = await apiFetch(`/api/events/${eventId}/tickets/${ticketId}/reactivate`, {
        token,
        method: "POST",
        body: JSON.stringify({ reason }),
    });
    return ticket;
}

export async function markTicketUsedManually(token, eventId, ticketId, { gate, reason } = {}) {
    const { ticket } = await apiFetch(`/api/events/${eventId}/tickets/${ticketId}/mark-used`, {
        token,
        method: "POST",
        body: JSON.stringify({ gate, reason }),
    });
    return ticket;
}

export async function deleteTicket(token, eventId, ticketId, { reason } = {}) {
    await apiFetch(`/api/events/${eventId}/tickets/${ticketId}`, {
        token,
        method: "DELETE",
        body: JSON.stringify({ reason }),
    });
}
