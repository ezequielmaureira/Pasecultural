import { apiFetch } from "./api.js";

// Todo público, sin sesión: el registro y la verificación por código de 6
// dígitos reemplazan por completo el login con Clerk en este flujo — recién
// hace falta Clerk cuando la persona ya activa quiere entrar a /scanner.

export async function getScannerInvitation(token) {
    const { invitation } = await apiFetch(`/api/scanner-invitations/${token}`);
    return invitation;
}

// Paso 3+4: nombre/apellido/DNI/email/teléfono (opcional). Dispara el envío
// del código de 6 dígitos por email.
export async function registerScannerInvitation(invitationToken, { firstName, lastName, document, email, phone }) {
    const { result } = await apiFetch(`/api/scanner-invitations/${invitationToken}/register`, {
        method: "POST",
        body: JSON.stringify({ firstName, lastName, document, email, phone }),
    });
    return result;
}

export async function resendScannerVerificationCode(invitationToken) {
    const { result } = await apiFetch(`/api/scanner-invitations/${invitationToken}/resend`, { method: "POST" });
    return result;
}

// Paso 7+8: si el código es correcto, la invitación queda ACTIVE de una.
export async function verifyScannerInvitationCode(invitationToken, code) {
    const { invitation } = await apiFetch(`/api/scanner-invitations/${invitationToken}/verify`, {
        method: "POST",
        body: JSON.stringify({ code }),
    });
    return invitation;
}
