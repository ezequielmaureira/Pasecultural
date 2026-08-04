import { apiFetch } from "./api.js";

// Devuelve también `scanner` (name/gate) — el "puesto del scanner" que
// muestra la pantalla de escaneo, resuelto por el backend a partir del
// scannerSessionToken (nunca elegido/editable del lado del cliente).
export async function listScannerEvents(token) {
    const { events, scanner } = await apiFetch("/api/scanner/events", { token });
    return { events, scanner };
}

// `qrToken` es el texto crudo decodificado del QR (formato "<ticketId>.<secret>",
// ver backend) — se reenvía tal cual, nunca se parsea del lado del cliente.
export async function validateScan(token, { qrToken, eventId, functionId }) {
    return apiFetch("/api/scanner/validate", {
        token,
        method: "POST",
        body: JSON.stringify({ token: qrToken, eventId, functionId }),
    });
}

// Sin `limit`: se deja que el backend aplique su propio default — no tiene
// sentido que el frontend tenga una opinión sobre ese número.
export async function listScanAttempts(token, { eventId, functionId }) {
    const params = new URLSearchParams({ eventId });
    if (functionId) params.set("functionId", functionId);
    const { attempts } = await apiFetch(`/api/scanner/scan-attempts?${params.toString()}`, { token });
    return attempts;
}
