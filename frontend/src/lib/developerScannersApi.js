import { apiFetch } from "./api.js";

// GET /api/developer/scanners — listado platform-wide, paginado y
// filtrable, exclusivo DEVELOPER (ver backend/src/services/developerScanners.service.js).
// Mismo patrón que developerTicketsApi.js: sólo se agregan al querystring
// los filtros presentes.
export async function listDeveloperScanners(token, { page, limit, search, organizationId, eventId, status } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", page);
    if (limit) params.set("limit", limit);
    if (search?.trim()) params.set("search", search.trim());
    if (organizationId) params.set("organizationId", organizationId);
    if (eventId) params.set("eventId", eventId);
    if (status) params.set("status", status);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch(`/api/developer/scanners${query}`, { token });
}

// GET /api/developer/scanners/:id — detalle de sólo lectura (PII + últimos
// 20 check-ins), pedido bajo demanda al abrir el drawer.
export async function getDeveloperScanner(token, scannerId) {
    const { scanner } = await apiFetch(`/api/developer/scanners/${scannerId}`, { token });
    return scanner;
}
