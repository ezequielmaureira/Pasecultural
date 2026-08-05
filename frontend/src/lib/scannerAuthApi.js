import { apiFetch } from "./api.js";

// Portal Scanner ("Soy Scanner") — login recurrente de un scanner YA
// registrado, por email + código de 6 dígitos. Reemplaza a la invitación
// como forma de volver a entrar (ver ScannerInvitationClaim.jsx, que ahora
// sólo sirve para el registro inicial). Todo público, sin sesión.

export async function requestScannerLoginCode(email) {
    return apiFetch("/api/scanner-auth/request-code", {
        method: "POST",
        body: JSON.stringify({ email }),
    });
}

export async function resendScannerLoginCode(email) {
    return apiFetch("/api/scanner-auth/resend-code", {
        method: "POST",
        body: JSON.stringify({ email }),
    });
}

// Paso 2: si el código es correcto, devuelve el scannerSessionToken — la
// MISMA credencial que ya emite el registro por invitación.
export async function verifyScannerLoginCode(email, code) {
    return apiFetch("/api/scanner-auth/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
    });
}
