import { apiFetch, apiFetchBlob } from "./api.js";

// Mismo patrón que saleAdminApi.js/ticketAdminApi.js: wrappers finos sobre
// apiFetch, sin lógica propia — todo lo de negocio vive en el backend
// (courtesy.service.js). Separado de saleApi.js/saleAdminApi.js a propósito:
// ese módulo es exclusivamente ventas reales, este es exclusivamente
// Cortesías, aunque debajo compartan la misma infraestructura de Sale.

export async function issueCourtesy(token, payload) {
    const { sale, tickets, shareUrl, emailDeliveryStatus } = await apiFetch("/api/courtesies", {
        token,
        method: "POST",
        body: JSON.stringify(payload),
    });
    return { sale, tickets, shareUrl, emailDeliveryStatus };
}

export async function listCourtesies(token, { eventId, functionId, reason, status, dateFrom, dateTo } = {}) {
    const params = new URLSearchParams();
    if (eventId) params.set("eventId", eventId);
    if (functionId) params.set("functionId", functionId);
    if (reason) params.set("reason", reason);
    if (status) params.set("status", status);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    const { courtesies } = await apiFetch(`/api/courtesies${query}`, { token });
    return courtesies;
}

export async function getCourtesyStats(token, eventId) {
    const params = new URLSearchParams({ eventId });
    const { stats } = await apiFetch(`/api/courtesies/stats?${params.toString()}`, { token });
    return stats;
}

export async function resendCourtesyEmail(token, saleId) {
    return apiFetch(`/api/courtesies/${saleId}/resend-email`, { token, method: "POST" });
}

export async function downloadCourtesyPdf(token, saleId) {
    const { blob, filename } = await apiFetchBlob(`/api/courtesies/${saleId}/pdf`, { token });
    return { blob, filename };
}

export async function cancelCourtesy(token, saleId) {
    return apiFetch(`/api/courtesies/${saleId}/cancel`, { token, method: "POST" });
}
