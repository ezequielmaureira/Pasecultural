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

// Mismo criterio que ACTIVE_TICKET_STATUSES en sale.service.js:16 — un
// ticket "vendido" es el que ocupa stock real (nunca CANCELLED/REFUNDED).
const SOLD_TICKET_STATUSES = ["ACTIVE", "USED"];

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
export async function getFunctionStats(client, functionId) {
  const [assignments, checkedInGroups, soldGroups] = await Promise.all([
    getFunctionCapacityAssignments(client, functionId),
    client.ticket.groupBy({
      by: ["ticketTypeId"],
      where: { functionId, status: "USED" },
      _count: { _all: true },
    }),
    client.ticket.groupBy({
      by: ["ticketTypeId"],
      where: { functionId, status: { in: SOLD_TICKET_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const checkedInByType = new Map(checkedInGroups.map((g) => [g.ticketTypeId, g._count._all]));
  const soldByType = new Map(soldGroups.map((g) => [g.ticketTypeId, g._count._all]));

  const byTicketType = assignments.map((a) => {
    const checkedIn = checkedInByType.get(a.ticketTypeId) ?? 0;
    const sold = soldByType.get(a.ticketTypeId) ?? 0;
    return {
      ticketTypeId: a.ticketTypeId,
      name: a.name,
      capacity: a.capacity,
      sold,
      checkedIn,
      remaining: Math.max(a.capacity - checkedIn, 0),
    };
  });

  const totals = byTicketType.reduce(
    (acc, t) => ({ capacity: acc.capacity + t.capacity, sold: acc.sold + t.sold, checkedIn: acc.checkedIn + t.checkedIn }),
    { capacity: 0, sold: 0, checkedIn: 0 }
  );

  return {
    capacity: totals.capacity,
    sold: totals.sold,
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

  const [assignments, checkedInGroups, soldGroups] = await Promise.all([
    client.functionTicketType.findMany({
      where: { functionId: { in: functionIds }, enabled: true },
      select: { functionId: true, quantityOverride: true, ticketType: { select: { quantity: true } } },
    }),
    client.ticket.groupBy({
      by: ["functionId"],
      where: { functionId: { in: functionIds }, status: "USED" },
      _count: { _all: true },
    }),
    client.ticket.groupBy({
      by: ["functionId"],
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
  const soldByFunction = new Map(soldGroups.map((g) => [g.functionId, g._count._all]));

  return functions.map((fn) => {
    const capacity = capacityByFunction.get(fn.id) ?? 0;
    const checkedIn = checkedInByFunction.get(fn.id) ?? 0;
    const sold = soldByFunction.get(fn.id) ?? 0;
    return {
      functionId: fn.id,
      date: fn.date,
      venue: fn.venue,
      capacity,
      sold,
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
