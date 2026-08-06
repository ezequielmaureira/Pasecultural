import { apiFetch } from "./api.js";

// GET /api/sales (requireRole ORGANIZER) — ya existía completo en el backend
// (sale.service.js#listSalesOrganizerService) y nunca tuvo wrapper del lado
// frontend. Mismo patrón que ticketAdminApi.js#listOrganizerTickets: token
// siempre primero, nada nuevo del lado servidor, sólo el wrapper que faltaba.
// Separado de saleApi.js a propósito: ese módulo es exclusivamente el
// checkout público/invitado (sin token) — mismo criterio de separación que
// ya existe entre ticketApi.js (comprador) y ticketAdminApi.js (organizador).
export async function listOrganizerSales(token, { status, eventId, dateFrom, dateTo, buyer } = {}) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (eventId) params.set("eventId", eventId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (buyer?.trim()) params.set("buyer", buyer.trim());
    const query = params.toString() ? `?${params.toString()}` : "";
    const { sales } = await apiFetch(`/api/sales${query}`, { token });
    return sales;
}
