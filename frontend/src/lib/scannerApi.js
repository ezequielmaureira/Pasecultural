import { apiFetch } from "./api.js";

// Pantalla previa "Dashboard Scanner" (antes de abrir el lector QR):
// identidad + estado + actividad de hoy, resuelto por el backend a partir
// del scannerSessionToken. `eventId` opcional: sin él, es el evento
// "ancla" con el que se inició sesión (comportamiento de siempre). Con un
// eventId de otra asignación activa del mismo scanner, trae el dashboard
// de ESE evento — el backend valida la pertenencia (resolveScannerAccess),
// nunca se confía en este id sin más.
export async function getScannerDashboard(token, eventId) {
    const params = eventId ? `?${new URLSearchParams({ eventId }).toString()}` : "";
    const { dashboard } = await apiFetch(`/api/scanner/dashboard${params}`, { token });
    return dashboard;
}

// Devuelve también `scanner` (name/gate) — el "puesto del scanner" que
// muestra la pantalla de escaneo, resuelto por el backend a partir del
// scannerSessionToken (nunca elegido/editable del lado del cliente).
export async function listScannerEvents(token) {
    const { events, scanner } = await apiFetch("/api/scanner/events", { token });
    return { events, scanner };
}

// Estadísticas de una función puntual (capacidad/ingresados/restantes +
// desglose por tipo de entrada) — endpoint que ya existía en el backend
// pero el frontend nunca consumía (sólo se mostraban los totales que ya
// trae listScannerEvents). Se usa en ScannerStatsScreen.jsx.
export async function getFunctionStats(token, eventId, functionId) {
    const { stats } = await apiFetch(`/api/scanner/events/${eventId}/functions/${functionId}/stats`, { token });
    return stats;
}

// Momento 1: ESCANEAR. Valida el QR SIN registrar nada — nunca genera
// CheckIn, nunca gasta el ingreso, nunca cuenta para las estadísticas (por
// eso no devuelve `stats`, a diferencia de checkIn). `qrToken` es el texto
// crudo decodificado del QR (formato "<ticketId>.<secret>", ver backend) —
// se reenvía tal cual, nunca se parsea del lado del cliente.
export async function scanTicket(token, { qrToken, eventId, functionId }) {
    return apiFetch("/api/scanner/scan", {
        token,
        method: "POST",
        body: JSON.stringify({ token: qrToken, eventId, functionId }),
    });
}

// Momento 2: CONFIRMAR EL INGRESO. El único que de verdad registra algo. El
// backend vuelve a correr TODAS las reglas desde cero (nunca confía en lo
// que dijo scanTicket) — ver checkInService.
export async function checkIn(token, { qrToken, eventId, functionId }) {
    return apiFetch("/api/scanner/check-in", {
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
