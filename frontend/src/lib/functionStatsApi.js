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

// GET /api/events/mine/stats — resumen batcheado de capacidad/emitidas/
// vendidas/ingresadas de TODOS los eventos del organizador (una fila por
// evento). Única fuente de estos números para la grilla "Estado de mis
// eventos" del Dashboard — antes se tallaban a mano sobre la lista completa
// de tickets del organizador.
export async function getMyEventsStats(token) {
    const { events } = await apiFetch("/api/events/mine/stats", { token });
    return events;
}
