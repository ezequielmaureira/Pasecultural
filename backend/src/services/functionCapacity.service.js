import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getOwnedEvent } from "./eventScanner.service.js";

// Única definición de "cuánta capacidad tiene un TicketType para una
// función puntual" de toda la app: override de la función si existe, si no
// el quantity del catálogo. Antes vivía duplicada dos veces dentro de
// sale.service.js (createSale/confirmSale) — se extrajo acá y sale.service
// pasa a importarla, igual que el dominio de scanner.
export function effectiveCapacity(assignment) {
  return assignment.quantityOverride ?? assignment.ticketType.quantity;
}

// Única definición de qué estados de Ticket "ocupan stock real" (nunca
// CANCELLED/REFUNDED) — sale.service.js y event.service.js la importan de
// acá en vez de repetir el mismo array.
export const SOLD_TICKET_STATUSES = ["ACTIVE", "USED"];

// Trae, para una función, sólo las asignaciones habilitadas (las que
// realmente cuentan como capacidad vendible) con lo mínimo necesario para
// calcular capacidad: ticketTypeId, nombre, y el override/quantity.
async function getFunctionCapacityAssignments(client, functionId) {
  const assignments = await client.functionTicketType.findMany({
    where: { functionId, enabled: true },
    select: {
      ticketTypeId: true,
      quantityOverride: true,
      ticketType: { select: { name: true, quantity: true } },
    },
  });

  return assignments.map((a) => ({
    ticketTypeId: a.ticketTypeId,
    name: a.ticketType.name,
    capacity: effectiveCapacity(a),
  }));
}

// Versión liviana: sólo los 4 números totales, sin desglose por tipo de
// entrada. Es la que usa validate() en cada scan (hot path) — counts
// agregados, no un groupBy, porque acá no hace falta el desglose. `sold` se
// agregó en la Iteración 1 del Dashboard del Organizador: es un campo más
// en el mismo objeto, no rompe a quien ya destructura sólo
// capacity/checkedIn/remaining (ver pantallas de Scanner).
export async function getFunctionCounters(client, functionId) {
  const [assignments, checkedIn, sold] = await Promise.all([
    getFunctionCapacityAssignments(client, functionId),
    client.ticket.count({ where: { functionId, status: "USED" } }),
    client.ticket.count({ where: { functionId, status: { in: SOLD_TICKET_STATUSES } } }),
  ]);

  const capacity = assignments.reduce((sum, a) => sum + a.capacity, 0);
  return { capacity, sold, checkedIn, remaining: Math.max(capacity - checkedIn, 0) };
}

// Versión completa: totales + desglose por TicketType (nombres libres del
// organizador, sin categorías fijas). groupBy agregados en vez de un count()
// por tipo de entrada — sigue siendo O(1) queries sin importar cuántos
// tickets tenga la función.
//
// `sold` cuenta sólo origin=SALE (ventas comerciales reales). `issued` es el
// total emitido sin importar origen (lo que `sold` significaba antes de que
// existieran las Cortesías) e `issuedByOrigin` desglosa por origen — un
// origen nuevo (STAFF, VIP, PRENSA, etc.) aparece solo en ese objeto en
// cuanto se emite el primer ticket con ese origen, sin tocar este archivo.
export async function getFunctionStats(client, functionId) {
  const [assignments, checkedInGroups, issuedGroups] = await Promise.all([
    getFunctionCapacityAssignments(client, functionId),
    client.ticket.groupBy({
      by: ["ticketTypeId"],
      where: { functionId, status: "USED" },
      _count: { _all: true },
    }),
    client.ticket.groupBy({
      by: ["ticketTypeId", "origin"],
      where: { functionId, status: { in: SOLD_TICKET_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const checkedInByType = new Map(checkedInGroups.map((g) => [g.ticketTypeId, g._count._all]));

  const soldByType = new Map();
  const issuedByType = new Map();
  const issuedByOriginByType = new Map();
  for (const g of issuedGroups) {
    const count = g._count._all;
    issuedByType.set(g.ticketTypeId, (issuedByType.get(g.ticketTypeId) ?? 0) + count);
    if (g.origin === "SALE") soldByType.set(g.ticketTypeId, (soldByType.get(g.ticketTypeId) ?? 0) + count);
    const originCounts = issuedByOriginByType.get(g.ticketTypeId) ?? {};
    originCounts[g.origin] = (originCounts[g.origin] ?? 0) + count;
    issuedByOriginByType.set(g.ticketTypeId, originCounts);
  }

  const byTicketType = assignments.map((a) => {
    const checkedIn = checkedInByType.get(a.ticketTypeId) ?? 0;
    return {
      ticketTypeId: a.ticketTypeId,
      name: a.name,
      capacity: a.capacity,
      sold: soldByType.get(a.ticketTypeId) ?? 0,
      issued: issuedByType.get(a.ticketTypeId) ?? 0,
      issuedByOrigin: issuedByOriginByType.get(a.ticketTypeId) ?? {},
      checkedIn,
      remaining: Math.max(a.capacity - checkedIn, 0),
    };
  });

  const totals = byTicketType.reduce(
    (acc, t) => {
      acc.capacity += t.capacity;
      acc.sold += t.sold;
      acc.issued += t.issued;
      acc.checkedIn += t.checkedIn;
      for (const [origin, count] of Object.entries(t.issuedByOrigin)) {
        acc.issuedByOrigin[origin] = (acc.issuedByOrigin[origin] ?? 0) + count;
      }
      return acc;
    },
    { capacity: 0, sold: 0, issued: 0, checkedIn: 0, issuedByOrigin: {} }
  );

  return {
    capacity: totals.capacity,
    sold: totals.sold,
    issued: totals.issued,
    issuedByOrigin: totals.issuedByOrigin,
    checkedIn: totals.checkedIn,
    remaining: Math.max(totals.capacity - totals.checkedIn, 0),
    byTicketType,
  };
}

// Variante batched de getFunctionStats: en vez de una función a la vez,
// calcula capacidad/vendidas/ingresadas para TODAS las funciones vigentes
// (no CANCELLED) de un evento en una sola tanda de 3 consultas — evita
// llamar getFunctionStats una vez por función (N+1). Reutiliza
// effectiveCapacity tal cual; ninguna regla de capacidad se reimplementa acá,
// sólo se agrupa por functionId además de por ticketTypeId.
export async function getEventFunctionStats(client, eventId) {
  const functions = await client.eventFunction.findMany({
    where: { eventId, status: { not: "CANCELLED" } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, venue: true, status: true },
  });
  if (functions.length === 0) return [];

  const functionIds = functions.map((f) => f.id);

  const [assignments, checkedInGroups, issuedGroups] = await Promise.all([
    client.functionTicketType.findMany({
      where: { functionId: { in: functionIds }, enabled: true },
      select: { functionId: true, quantityOverride: true, ticketType: { select: { quantity: true } } },
    }),
    client.ticket.groupBy({
      by: ["functionId"],
      where: { functionId: { in: functionIds }, status: "USED" },
      _count: { _all: true },
    }),
    // Igual criterio que getFunctionStats: se agrupa también por origin acá
    // para que sold (SALE)/issued (todos)/issuedByOrigin salgan de la misma
    // consulta batcheada, sin volver a N+1 por función.
    client.ticket.groupBy({
      by: ["functionId", "origin"],
      where: { functionId: { in: functionIds }, status: { in: SOLD_TICKET_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const capacityByFunction = new Map();
  for (const assignment of assignments) {
    const current = capacityByFunction.get(assignment.functionId) ?? 0;
    capacityByFunction.set(assignment.functionId, current + effectiveCapacity(assignment));
  }
  const checkedInByFunction = new Map(checkedInGroups.map((g) => [g.functionId, g._count._all]));

  const soldByFunction = new Map();
  const issuedByFunction = new Map();
  const issuedByOriginByFunction = new Map();
  for (const g of issuedGroups) {
    const count = g._count._all;
    issuedByFunction.set(g.functionId, (issuedByFunction.get(g.functionId) ?? 0) + count);
    if (g.origin === "SALE") soldByFunction.set(g.functionId, (soldByFunction.get(g.functionId) ?? 0) + count);
    const originCounts = issuedByOriginByFunction.get(g.functionId) ?? {};
    originCounts[g.origin] = (originCounts[g.origin] ?? 0) + count;
    issuedByOriginByFunction.set(g.functionId, originCounts);
  }

  return functions.map((fn) => {
    const capacity = capacityByFunction.get(fn.id) ?? 0;
    const checkedIn = checkedInByFunction.get(fn.id) ?? 0;
    return {
      functionId: fn.id,
      date: fn.date,
      venue: fn.venue,
      capacity,
      sold: soldByFunction.get(fn.id) ?? 0,
      issued: issuedByFunction.get(fn.id) ?? 0,
      issuedByOrigin: issuedByOriginByFunction.get(fn.id) ?? {},
      checkedIn,
      remaining: Math.max(capacity - checkedIn, 0),
    };
  });
}

// Wrapper con auth de organizador (dueño del evento) para
// getEventFunctionStats — ver eventScanner.controller.js/ticketAdmin.service.js
// para el mismo criterio de autorización (getOwnedEvent, reusado tal cual).
// Es el único punto nuevo de esta iteración: getEventFunctionStats/
// getFunctionStats/effectiveCapacity no se tocan por fuera de este archivo.
export const getOrganizerEventFunctionStatsService = async (clerkId, eventId) => {
  const owned = await getOwnedEvent(clerkId, eventId);
  if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

  return getEventFunctionStats(prisma, eventId);
};
