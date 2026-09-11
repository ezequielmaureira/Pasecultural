// Regla "evento finalizado = evento finalizado" (ronda EVENT_FINISHED_GUARD)
// — MISMO cálculo temporal que ya usa pages/organizer/dashboard/
// dashboardMetrics.js (getFunctionEndBoundary/getFunctionTemporalState) y
// backend/src/services/eventArchive.service.js (getFunctionEndBoundary/
// getFunctionTemporalState/isFunctionFinished). Se duplica acá (no se
// importa) por el mismo motivo ya aceptado en ese archivo: no hay forma de
// compartir código entre React y Node en este proyecto tal como está
// armado. Si alguna vez cambia una, hay que cambiar las tres a mano.
function getFunctionEndBoundary(fn) {
  if (fn.endAt) return new Date(fn.endAt);
  const endOfDay = new Date(fn.date);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay;
}

function getFunctionTemporalState(fn, now) {
  if (fn.doorsOpenAt) {
    const opens = new Date(fn.doorsOpenAt);
    if (now >= opens && now <= getFunctionEndBoundary(fn)) return "ongoing";
  }
  return now > getFunctionEndBoundary(fn) ? "finished" : "upcoming";
}

// Un evento público (payload de /api/events/public/:slug, que sólo trae
// funciones SCHEDULED) se considera finalizado cuando TODAS sus funciones
// vigentes ya pasaron su boundary — mismo criterio que el guard autoritativo
// del backend (assertFunctionActive), sólo que acá es de sólo lectura (para
// UI), nunca la fuente de verdad: la compra real la sigue bloqueando el
// backend aunque esta función tuviera un bug o quedara desactualizada.
export function isEventFinished(event, now = new Date()) {
  const functions = event?.functions ?? [];
  if (functions.length === 0) return false;
  return functions.every((fn) => getFunctionTemporalState(fn, now) === "finished");
}
