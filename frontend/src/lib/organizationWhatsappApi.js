import { apiFetch } from "./api.js";

// Cambio seguro del número de WhatsApp AUTORIZADO de una organización
// (distinto de Organization.phone, el teléfono público/de contacto que ya
// administra OrganizerSettings.jsx vía PATCH /api/organizations/me).
// organizationId siempre viaja explícito: el backend igual revalida
// pertenencia real contra la sesión autenticada en cada llamada, nunca
// confía en este valor por sí solo.

export async function getWhatsappNumberStatus(token, organizationId) {
    return apiFetch(`/api/organizations/me/whatsapp-number?organizationId=${encodeURIComponent(organizationId)}`, { token });
}

export async function requestWhatsappNumberChange(token, organizationId, phone) {
    return apiFetch("/api/organizations/me/whatsapp-number/change/request", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId, phone }),
    });
}

export async function verifyWhatsappNumberChange(token, organizationId, code) {
    return apiFetch("/api/organizations/me/whatsapp-number/change/verify", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId, code }),
    });
}

export async function resendWhatsappNumberChangeCode(token, organizationId) {
    return apiFetch("/api/organizations/me/whatsapp-number/change/resend", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId }),
    });
}

export async function cancelWhatsappNumberChange(token, organizationId) {
    return apiFetch("/api/organizations/me/whatsapp-number/change/cancel", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId }),
    });
}
