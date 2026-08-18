import { apiFetch } from "./api.js";

// MP-1 — onboarding OAuth de Mercado Pago (Organization ↔ OAuth ↔ Mercado
// Pago). Esta fase SÓLO conecta la cuenta: no hay checkout, preferencias
// de pago ni cobros todavía. organizationId siempre viaja explícito: el
// backend igual revalida pertenencia real contra la sesión autenticada.

export async function getMercadoPagoStatus(token, organizationId) {
    return apiFetch(`/api/organizations/me/mercadopago/status?organizationId=${encodeURIComponent(organizationId)}`, { token });
}

// Devuelve {authorizationUrl} — el caller hace `window.location.href =
// authorizationUrl` para la navegación real hacia Mercado Pago (nunca un
// redirect dentro de la llamada fetch, ver el informe de entrega de MP-1).
export async function startMercadoPagoConnect(token, organizationId) {
    return apiFetch(`/api/organizations/me/mercadopago/connect?organizationId=${encodeURIComponent(organizationId)}`, { token });
}

// Bug fix (desconexión de Mercado Pago) — desconecta la cuenta vinculada a
// esta organización. El backend nunca borra ni devuelve tokens acá: sólo
// {disconnected:true}.
export async function disconnectMercadoPagoConnection(token, organizationId) {
    return apiFetch("/api/organizations/me/mercadopago/disconnect", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId }),
    });
}
