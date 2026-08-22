import { apiFetch } from "./api.js";

// Verificación de teléfono/WhatsApp de Organización — ÚNICO mecanismo de
// WhatsApp del Dashboard (ver el informe de entrega "unificación
// WhatsApp"): el mismo número, una vez verificado, sirve como contacto
// público y como número autorizado para administrar por chatbot.
// organizationId siempre explícito, mismo criterio que el resto de las
// llamadas /me/*.
//
// Flujo invertido: request/verifyOrganizationPhoneChangeOtp/resend pueden
// devolver {step: "WHATSAPP_PENDING", deepLink} — `deepLink` es la URL
// wa.me que hay que abrir (nunca se reconstruye en el frontend: el backend
// es el único que conoce el número oficial y el token en texto plano, y
// sólo lo devuelve en la respuesta que lo emite).
export async function getOrganizationPhoneStatus(token, organizationId) {
    return apiFetch(`/api/organizations/me/phone-verification?organizationId=${encodeURIComponent(organizationId)}`, { token });
}

export async function requestOrganizationPhoneVerification(token, organizationId, phone) {
    return apiFetch("/api/organizations/me/phone-verification/request", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId, phone }),
    });
}

export async function verifyOrganizationPhoneChangeOtp(token, organizationId, code) {
    return apiFetch("/api/organizations/me/phone-verification/email-otp/verify", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId, code }),
    });
}

export async function resendOrganizationPhoneChangeOtp(token, organizationId) {
    return apiFetch("/api/organizations/me/phone-verification/email-otp/resend", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId }),
    });
}

export async function resendOrganizationPhoneWhatsapp(token, organizationId) {
    return apiFetch("/api/organizations/me/phone-verification/whatsapp/resend", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId }),
    });
}

export async function cancelOrganizationPhoneChange(token, organizationId) {
    return apiFetch("/api/organizations/me/phone-verification/cancel", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId }),
    });
}

// Sirve tanto "Eliminar número" (no verificado) como "Eliminar WhatsApp de
// contacto" (verificado) — distinto de cancelOrganizationPhoneChange:
// cancel sólo descarta un intento en curso, esto elimina el teléfono
// oficial mismo.
export async function deleteOrganizationPhone(token, organizationId) {
    return apiFetch("/api/organizations/me/phone-verification/delete", {
        token,
        method: "POST",
        body: JSON.stringify({ organizationId }),
    });
}
