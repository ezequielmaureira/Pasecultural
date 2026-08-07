// Selección/agregación pura para "Estadísticas del evento" — la usa
// OrganizerTickets.jsx y OrganizerDashboard.jsx (y queda lista para
// cualquier pantalla futura que necesite lo mismo, ej. "Evento en Vivo").
// Nunca recalcula capacidad ni el criterio de qué cuenta como "vendida"/
// "emitida"/"cancelada": esos números ya vienen agregados de GET
// /api/events/:eventId/functions/stats
// (functionCapacity.service.js#getEventFunctionStats) o de GET
// /api/events/mine/stats (getOrganizerEventsSummaryService). Lo único que
// pasa acá es (a) elegir la fila de una función puntual, o (b) sumar filas
// que el backend ya agregó — nunca una regla de negocio nueva. Ésta es la
// única fuente de estadísticas de entradas/ocupación/accesos del frontend.

import { getOriginMeta } from "../../lib/ticketOrigin.js";

const isAllFunctions = (functionId) => !functionId || functionId === "ALL";

// `sold` = sólo origin SALE (comercial). `issued` = todos los orígenes
// (venta + cortesía + cualquier origen futuro), es la base real de ocupación.
// `issuedByOrigin` se suma clave a clave para que un origen nuevo aparezca
// solo, sin tocar este selector de nuevo. `cancelled` = CANCELLED+REFUNDED,
// entradas emitidas que ya no dan derecho a ingresar.
const EMPTY_CAPACITY_STATS = { capacity: 0, sold: 0, issued: 0, issuedByOrigin: {}, checkedIn: 0, cancelled: 0 };

function mergeIssuedByOrigin(acc, issuedByOrigin = {}) {
  const merged = { ...acc };
  for (const [origin, count] of Object.entries(issuedByOrigin)) {
    merged[origin] = (merged[origin] ?? 0) + count;
  }
  return merged;
}

export function selectFunctionCapacityStats(functionStats, functionId) {
  if (isAllFunctions(functionId)) {
    return functionStats.reduce(
      (acc, fn) => ({
        capacity: acc.capacity + fn.capacity,
        sold: acc.sold + fn.sold,
        issued: acc.issued + (fn.issued ?? fn.sold),
        issuedByOrigin: mergeIssuedByOrigin(acc.issuedByOrigin, fn.issuedByOrigin),
        checkedIn: acc.checkedIn + fn.checkedIn,
        cancelled: acc.cancelled + (fn.cancelled ?? 0),
      }),
      EMPTY_CAPACITY_STATS
    );
  }

  const match = functionStats.find((fn) => fn.functionId === functionId);
  return match
    ? {
        capacity: match.capacity,
        sold: match.sold,
        issued: match.issued ?? match.sold,
        issuedByOrigin: match.issuedByOrigin ?? {},
        checkedIn: match.checkedIn,
        cancelled: match.cancelled ?? 0,
      }
    : EMPTY_CAPACITY_STATS;
}

// Recaudación: suma de `total` de ventas CONFIRMED (GET /api/sales), nunca
// se mueve al backend por decisión explícita — es aritmética sobre valores
// ya finales (cada `sale.total` quedó congelado en sale.service.js al
// confirmarse la venta), no una regla de negocio reimplementada.
export function selectRevenue(sales, functionId) {
  return sales
    .filter((sale) => sale.status === "CONFIRMED")
    .filter((sale) => isAllFunctions(functionId) || sale.functionId === functionId)
    .reduce((sum, sale) => sum + Number(sale.total ?? 0), 0);
}

export function buildEventStatsKpis({ functionStats, sales, functionId }) {
  const { capacity, sold, issued, issuedByOrigin, checkedIn, cancelled } = selectFunctionCapacityStats(
    functionStats,
    functionId
  );
  const revenue = selectRevenue(sales, functionId);
  // Ocupación: sobre lo emitido (todos los orígenes), no sólo lo vendido —
  // una cortesía ocupa un lugar físico igual que una venta.
  const occupancyPct = capacity > 0 ? Math.round((checkedIn / capacity) * 1000) / 10 : null;
  const averageTicket = sold > 0 ? revenue / sold : 0;
  const remaining = Math.max(capacity - checkedIn, 0);
  const pending = Math.max(issued - checkedIn, 0);

  return {
    revenue,
    averageTicket,
    sold,
    issued,
    issuedByOrigin,
    checkedIn,
    pending,
    cancelled,
    capacity,
    remaining,
    occupancyPct,
  };
}

// Arma el desglose de "Entradas emitidas" por canal, con nombres amigables
// y emoji (getOriginMeta) — nunca "SALE"/"COURTESY" crudos. SALE siempre
// primero (es el canal comercial); el resto en el orden que ya trae
// issuedByOrigin. Usado por el bloque "Emisión" de Entradas y del Dashboard.
export function buildIssuedByOriginBreakdown(issuedByOrigin) {
  const entries = Object.entries(issuedByOrigin ?? {}).filter(([, count]) => count > 0);
  entries.sort(([a], [b]) => (a === "SALE" ? -1 : b === "SALE" ? 1 : 0));
  return entries.map(([origin, count]) => ({ origin, count, ...getOriginMeta(origin) }));
}
