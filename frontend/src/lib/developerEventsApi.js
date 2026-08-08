import { apiFetch } from "./api.js";

// GET /api/developer/events — listado platform-wide, paginado y filtrable,
// exclusivo DEVELOPER (ver backend/src/services/developerEvents.service.js).
// Mismo patrón que ticketAdminApi.js#listOrganizerTickets/saleAdminApi.js#
// listOrganizerSales: sólo se agregan al querystring los filtros presentes.
export async function listDeveloperEvents(token, { page, limit, search, organizationId, status, visibility, archived } = {}) {
    const params = new URLSearchParams();
    if (page) params.set("page", page);
    if (limit) params.set("limit", limit);
    if (search?.trim()) params.set("search", search.trim());
    if (organizationId) params.set("organizationId", organizationId);
    if (status) params.set("status", status);
    if (visibility) params.set("visibility", visibility);
    if (archived) params.set("archived", archived);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch(`/api/developer/events${query}`, { token });
}

// GET /api/developer/organizations/options — sólo {id, name}, para llenar
// el <select> de organización. Se pide una única vez al montar la pantalla.
export async function getDeveloperOrganizationOptions(token) {
    const { organizations } = await apiFetch("/api/developer/organizations/options", { token });
    return organizations;
}
