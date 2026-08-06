import { apiFetch } from "./api.js";

// GET /api/events/:eventId/functions/stats — variante organizador de
// functionCapacity.service.js#getEventFunctionStats (Iteración 1 del
// Dashboard). Mismo cálculo de capacidad que ya usa el Scanner
// (effectiveCapacity/getFunctionStats), sólo que batcheado para todas las
// funciones del evento y con auth de organizador en vez de sesión de
// scanner.
export async function getEventFunctionStats(token, eventId) {
    const { functions } = await apiFetch(`/api/events/${eventId}/functions/stats`, { token });
    return functions;
}
