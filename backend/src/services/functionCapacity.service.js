import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getOwnedEvent } from "./eventScanner.service.js";
import { getMyOrganizationService } from "./organization.service.js";

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

// Estados que significan "esta entrada ya no da derecho a ingresar" — el
// complemento exacto de SOLD_TICKET_STATUSES. Se usa sólo para el bloque
// "Accesos" (Cancelada/Reintegrada), nunca para capacidad/stock.
const CANCELLED_TICKET_STATUSES = ["CANCELLED", "REFUNDED"];

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
  const [assignments, checkedInGroups, issuedGroups, cancelledGroups] = await Promise.all([
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
    client.ticket.groupBy({
      by: ["ticketTypeId"],
      where: { functionId, status: { in: CANCELLED_TICKET_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const checkedInByType = new Map(checkedInGroups.map((g) => [g.ticketTypeId, g._count._all]));
  const cancelledByType = new Map(cancelledGroups.map((g) => [g.ticketTypeId, g._count._all]));

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
      cancelled: cancelledByType.get(a.ticketTypeId) ?? 0,
      remaining: Math.max(a.capacity - checkedIn, 0),
    };
  });

  const totals = byTicketType.reduce(
    (acc, t) => {
      acc.capacity += t.capacity;
      acc.sold += t.sold;
      acc.issued += t.issued;
      acc.checkedIn += t.checkedIn;
      acc.cancelled += t.cancelled;
      for (const [origin, count] of Object.entries(t.issuedByOrigin)) {
        acc.issuedByOrigin[origin] = (acc.issuedByOrigin[origin] ?? 0) + count;
      }
      return acc;
    },
    { capacity: 0, sold: 0, issued: 0, checkedIn: 0, cancelled: 0, issuedByOrigin: {} }
  );

  return {
    capacity: totals.capacity,
    sold: totals.sold,
    issued: totals.issued,
    issuedByOrigin: totals.issuedByOrigin,
    checkedIn: totals.checkedIn,
    cancelled: totals.cancelled,
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

  const [assignments, checkedInGroups, issuedGroups, cancelledGroups] = await Promise.all([
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
    client.ticket.groupBy({
      by: ["functionId"],
      where: { functionId: { in: functionIds }, status: { in: CANCELLED_TICKET_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const capacityByFunction = new Map();
  for (const assignment of assignments) {
    const current = capacityByFunction.get(assignment.functionId) ?? 0;
    capacityByFunction.set(assignment.functionId, current + effectiveCapacity(assignment));
  }
  const checkedInByFunction = new Map(checkedInGroups.map((g) => [g.functionId, g._count._all]));
  const cancelledByFunction = new Map(cancelledGroups.map((g) => [g.functionId, g._count._all]));

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
      cancelled: cancelledByFunction.get(fn.id) ?? 0,
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

// Variante batched de getEventFunctionStats, un nivel más arriba: en vez de
// todas las funciones de UN evento, calcula capacidad/emitidas/vendidas/
// ingresadas de TODOS los eventos vigentes del organizador en una sola tanda
// de consultas. Es la única fuente de estos números para la grilla "Estado
// de mis eventos" del Dashboard — antes cada card los tallaba a mano sobre
// la lista completa de tickets del organizador (sin distinguir origen, y
// duplicando esta misma cuenta). Mismos criterios que getEventFunctionStats
// (SOLD_TICKET_STATUSES/CANCELLED_TICKET_STATUSES/effectiveCapacity), sólo
// agrupado por eventId en vez de por functionId.
export const getOrganizerEventsSummaryService = async (clerkId) => {
  const organization = await getMyOrganizationService(clerkId);
  if (!organization) return [];

  const events = await prisma.event.findMany({
    where: { organizationId: organization.id, archivedAt: null },
    select: { id: true },
  });
  if (events.length === 0) return [];
  const eventIds = events.map((e) => e.id);

  const [assignments, checkedInGroups, issuedGroups, cancelledGroups] = await Promise.all([
    prisma.functionTicketType.findMany({
      where: {
        enabled: true,
        function: { eventId: { in: eventIds }, status: { not: "CANCELLED" } },
      },
      select: { quantityOverride: true, ticketType: { select: { quantity: true } }, function: { select: { eventId: true } } },
    }),
    prisma.ticket.groupBy({
      by: ["eventId"],
      where: { eventId: { in: eventIds }, status: "USED" },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ["eventId", "origin"],
      where: { eventId: { in: eventIds }, status: { in: SOLD_TICKET_STATUSES } },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ["eventId"],
      where: { eventId: { in: eventIds }, status: { in: CANCELLED_TICKET_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const capacityByEvent = new Map();
  for (const assignment of assignments) {
    const eventId = assignment.function.eventId;
    const current = capacityByEvent.get(eventId) ?? 0;
    capacityByEvent.set(eventId, current + effectiveCapacity(assignment));
  }
  const checkedInByEvent = new Map(checkedInGroups.map((g) => [g.eventId, g._count._all]));
  const cancelledByEvent = new Map(cancelledGroups.map((g) => [g.eventId, g._count._all]));

  const soldByEvent = new Map();
  const issuedByEvent = new Map();
  const issuedByOriginByEvent = new Map();
  for (const g of issuedGroups) {
    const count = g._count._all;
    issuedByEvent.set(g.eventId, (issuedByEvent.get(g.eventId) ?? 0) + count);
    if (g.origin === "SALE") soldByEvent.set(g.eventId, (soldByEvent.get(g.eventId) ?? 0) + count);
    const originCounts = issuedByOriginByEvent.get(g.eventId) ?? {};
    originCounts[g.origin] = (originCounts[g.origin] ?? 0) + count;
    issuedByOriginByEvent.set(g.eventId, originCounts);
  }

  return eventIds.map((eventId) => {
    const capacity = capacityByEvent.get(eventId) ?? 0;
    const checkedIn = checkedInByEvent.get(eventId) ?? 0;
    return {
      eventId,
      capacity,
      sold: soldByEvent.get(eventId) ?? 0,
      issued: issuedByEvent.get(eventId) ?? 0,
      issuedByOrigin: issuedByOriginByEvent.get(eventId) ?? {},
      checkedIn,
      cancelled: cancelledByEvent.get(eventId) ?? 0,
      remaining: Math.max(capacity - checkedIn, 0),
    };
  });
};

// "Vendidas" a nivel CATÁLOGO (pantalla Tipos de Entrada) — no es una
// variante de capacidad, pero reutiliza el mismo criterio de "vendido" que
// el resto del archivo (SOLD_TICKET_STATUSES + origin=SALE) en vez de
// definirlo de nuevo. Un mismo TicketType puede estar asignado a varias
// EventFunction (FunctionTicketType): acá NO se toca esa tabla en absoluto
// — se cuentan directamente los `Ticket` reales agrupados por
// `ticketTypeId`, sin importar en qué función fueron emitidos, así que un
// tipo usado en 3 funciones (10+15+8) da 33 en una sola fila, nunca 3 filas
// a sumar en el cliente. Una sola query agregada para TODOS los tipos de
// entrada de la organización — cero N+1, ni por evento ni por tipo.
export const getOrganizerTicketTypeSalesService = async (clerkId) => {
  const organization = await getMyOrganizationService(clerkId);
  if (!organization) return [];

  const soldGroups = await prisma.ticket.groupBy({
    by: ["ticketTypeId"],
    where: {
      status: { in: SOLD_TICKET_STATUSES },
      origin: "SALE",
      event: { organizationId: organization.id, archivedAt: null },
    },
    _count: { _all: true },
  });

  return soldGroups.map((g) => ({ ticketTypeId: g.ticketTypeId, sold: g._count._all }));
};
