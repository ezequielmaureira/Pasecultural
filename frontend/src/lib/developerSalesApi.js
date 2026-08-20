import { apiFetch } from "./api.js";

// GET /api/developer/sales — listado platform-wide, paginado y filtrable,
// exclusivo DEVELOPER (ver backend/src/services/developerSales.service.js).
// Mismo patrón que developerScannersApi.js: sólo se agregan al querystring
// los filtros presentes.
export async function listDeveloperSales(
    token,
    { page, limit, search, organizationId, eventId, status, needsReconciliation } = {}
) {
    const params = new URLSearchParams();
    if (page) params.set("page", page);
    if (limit) params.set("limit", limit);
    if (search?.trim()) params.set("search", search.trim());
    if (organizationId) params.set("organizationId", organizationId);
    if (eventId) params.set("eventId", eventId);
    if (status) params.set("status", status);
    if (needsReconciliation) params.set("needsReconciliation", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch(`/api/developer/sales${query}`, { token });
}

// GET /api/developer/sales/:id — detalle de sólo lectura (PII + items +
// tickets generados), pedido bajo demanda al abrir el drawer.
export async function getDeveloperSale(token, saleId) {
    const { sale } = await apiFetch(`/api/developer/sales/${saleId}`, { token });
    return sale;
}
