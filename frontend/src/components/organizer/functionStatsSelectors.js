// Selección/agregación pura para "Estadísticas del evento" — la usa
// OrganizerTickets.jsx y queda lista para cualquier pantalla futura que
// necesite lo mismo (ej. "Evento en Vivo"). Nunca recalcula capacidad ni el
// criterio de qué cuenta como "vendida": esos números ya vienen agregados
// de GET /api/events/:eventId/functions/stats
// (functionCapacity.service.js#getEventFunctionStats). Lo único que pasa
// acá es (a) elegir la fila de una función puntual, o (b) sumar filas que
// el backend ya agregó — nunca una regla de negocio nueva.

const isAllFunctions = (functionId) => !functionId || functionId === "ALL";

// `sold` = sólo origin SALE (comercial). `issued` = todos los orígenes
// (venta + cortesía + cualquier origen futuro), es la base real de ocupación.
// `issuedByOrigin` se suma clave a clave para que un origen nuevo aparezca
// solo, sin tocar este selector de nuevo.
const EMPTY_CAPACITY_STATS = { capacity: 0, sold: 0, issued: 0, issuedByOrigin: {}, checkedIn: 0 };

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
  const { capacity, sold, issued, issuedByOrigin, checkedIn } = selectFunctionCapacityStats(functionStats, functionId);
  const revenue = selectRevenue(sales, functionId);
  // Ocupación: sobre lo emitido (todos los orígenes), no sólo lo vendido —
  // una cortesía ocupa un lugar físico igual que una venta.
  const occupancyPct = capacity > 0 ? Math.round((checkedIn / capacity) * 1000) / 10 : null;
  const averageTicket = sold > 0 ? revenue / sold : 0;
  const remaining = Math.max(capacity - checkedIn, 0);
  const pending = Math.max(issued - checkedIn, 0);

  return { revenue, averageTicket, sold, issued, issuedByOrigin, checkedIn, pending, capacity, remaining, occupancyPct };
}

// Label legible para cada origen conocido — sólo cosmético. Un origen
// nuevo (STAFF, VIP, PRENSA, etc.) que todavía no tiene label acá igual se
// muestra (fallback capitalizado), nunca se cae ni desaparece del desglose.
const ORIGIN_LABELS = { SALE: "vendidas", COURTESY: "cortesías" };

function labelForOrigin(origin) {
  return ORIGIN_LABELS[origin] ?? origin.charAt(0) + origin.slice(1).toLowerCase();
}

// Arma "520 vendidas · 38 cortesías" a partir de issuedByOrigin — texto de
// apoyo bajo "Entradas emitidas", nunca la fuente de verdad del total.
export function formatIssuedByOriginHint(issuedByOrigin) {
  const entries = Object.entries(issuedByOrigin ?? {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return "";
  return entries.map(([origin, count]) => `${count} ${labelForOrigin(origin)}`).join(" · ");
}
