// Selección/agregación pura para "Estadísticas del evento" — la usa
// OrganizerTickets.jsx y queda lista para cualquier pantalla futura que
// necesite lo mismo (ej. "Evento en Vivo"). Nunca recalcula capacidad ni el
// criterio de qué cuenta como "vendida": esos números ya vienen agregados
// de GET /api/events/:eventId/functions/stats
// (functionCapacity.service.js#getEventFunctionStats). Lo único que pasa
// acá es (a) elegir la fila de una función puntual, o (b) sumar filas que
// el backend ya agregó — nunca una regla de negocio nueva.

const isAllFunctions = (functionId) => !functionId || functionId === "ALL";

export function selectFunctionCapacityStats(functionStats, functionId) {
  if (isAllFunctions(functionId)) {
    return functionStats.reduce(
      (acc, fn) => ({
        capacity: acc.capacity + fn.capacity,
        sold: acc.sold + fn.sold,
        checkedIn: acc.checkedIn + fn.checkedIn,
      }),
      { capacity: 0, sold: 0, checkedIn: 0 }
    );
  }

  const match = functionStats.find((fn) => fn.functionId === functionId);
  return match
    ? { capacity: match.capacity, sold: match.sold, checkedIn: match.checkedIn }
    : { capacity: 0, sold: 0, checkedIn: 0 };
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
  const { capacity, sold, checkedIn } = selectFunctionCapacityStats(functionStats, functionId);
  const revenue = selectRevenue(sales, functionId);
  const occupancyPct = capacity > 0 ? Math.round((checkedIn / capacity) * 1000) / 10 : null;

  return { revenue, sold, checkedIn, capacity, occupancyPct };
}
