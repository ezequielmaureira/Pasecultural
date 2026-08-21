import { apiFetch } from "./api.js";

// Botón de arrepentimiento — mismo modelo sin sesión que saleApi.js#requestSaleRecoveryCode
// (email+DNI sólo localizan, nunca autorizan; el código de 6 dígitos sí).
// La respuesta es SIEMPRE el mismo shape genérico, exista o no una compra
// real detrás — ver withdrawalRequestVerification.service.js en el backend.
export async function requestWithdrawalOtp({ email, buyerDocument }) {
    const { maskedEmail } = await apiFetch("/api/withdrawal-requests/otp", {
        method: "POST",
        body: JSON.stringify({ email, buyerDocument }),
    });
    return maskedEmail;
}

export async function resendWithdrawalOtp({ email, buyerDocument }) {
    const { maskedEmail } = await apiFetch("/api/withdrawal-requests/otp/resend", {
        method: "POST",
        body: JSON.stringify({ email, buyerDocument }),
    });
    return maskedEmail;
}

// Único punto que devuelve compras reales — recién después de un código
// correcto. Cada compra ya trae `saleToken`: es lo que autoriza el paso
// siguiente (registrar la solicitud), sin volver a pedir el código.
export async function verifyWithdrawalOtp({ email, buyerDocument, code }) {
    const { sales, maskedEmail } = await apiFetch("/api/withdrawal-requests/otp/verify", {
        method: "POST",
        body: JSON.stringify({ email, buyerDocument, code }),
    });
    return { sales, maskedEmail };
}

// Paso 3 — autorizado por saleToken (publicRecoveryToken de la Sale),
// nunca por sesión. `reason` es uno de los valores del enum
// WithdrawalRequestReason del backend (o undefined); `reasonNote` es texto
// libre opcional.
export async function createWithdrawalRequest(saleToken, { reason, reasonNote } = {}) {
    return apiFetch(`/api/withdrawal-requests/${encodeURIComponent(saleToken)}`, {
        method: "POST",
        body: JSON.stringify({ reason, reasonNote }),
    });
}

// Panel Organizer/Developer > Solicitudes.
export async function getWithdrawalRequests(token) {
    const { requests } = await apiFetch("/api/withdrawal-requests", { token });
    return requests;
}

export async function updateWithdrawalRequestStatus(token, withdrawalRequestId, status) {
    return apiFetch(`/api/withdrawal-requests/${encodeURIComponent(withdrawalRequestId)}/status`, {
        token,
        method: "POST",
        body: JSON.stringify({ status }),
    });
}
