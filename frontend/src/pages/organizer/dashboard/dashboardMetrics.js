// Funciones puras (sin JSX, sin fetch) que convierten `events`/`sales`/
// `tickets` — ya cargados por OrganizerDataContext — en lo que el Dashboard
// necesita mostrar. Separadas del componente para poder reutilizarlas desde
// otras pantallas del organizador y para no mezclar cálculo con presentación.

import { AUDIT_ACTION_LABEL } from "../ticketAdminDisplay.js";

// Mismo criterio que ACTIVE_TICKET_STATUSES en
// backend/src/services/sale.service.js:16 — nunca CANCELLED/REFUNDED.
const SOLD_TICKET_STATUSES = new Set(["ACTIVE", "USED"]);

// Un evento sólo "cuenta" para capacidad/ocupación si llegó a estar a la
// venta alguna vez (PUBLISHED o ya FINISHED) — un DRAFT/SCHEDULED puede tener
// tipos de entrada cargados sin que eso sea capacidad real, y un CANCELLED
// nunca vendió de verdad.
const CAPACITY_RELEVANT_EVENT_STATUSES = new Set(["PUBLISHED", "FINISHED"]);

// Espeja backend/src/services/functionCapacity.service.js#effectiveCapacity
// (misma fórmula de una línea, comentada ahí como "única definición de
// capacidad de toda la app"). Se duplica acá porque hoy no existe un
// endpoint que devuelva la capacidad ya calculada al organizador — ver
// Iteración 1 ("wrapper organizador de getFunctionStats"), que debería
// reemplazar este cálculo client-side por el real del backend.
export function effectiveCapacity(assignment) {
  return assignment.quantityOverride ?? assignment.ticketType?.quantity ?? 0;
}

// Capacidad total de un evento: suma de la capacidad de cada asignación
// habilitada, en cada función no cancelada.
export function computeEventCapacity(event) {
  if (!Array.isArray(event?.functions)) return 0;
  return event.functions
    .filter((fn) => fn.status !== "CANCELLED")
    .reduce((sum, fn) => {
      const assignments = fn.ticketAssignments ?? [];
      return sum + assignments.filter((a) => a.enabled).reduce((s, a) => s + effectiveCapacity(a), 0);
    }, 0);
}

// GET /api/tickets/organizer no filtra por evento cuando se pide completo —
// se agrupa una sola vez acá y se reusa para el KPI global y para cada card
// de "Estado de mis eventos", en vez de recorrer el array entero por evento.
export function groupTicketsByEvent(tickets) {
  const map = new Map();
  for (const ticket of tickets) {
    if (!map.has(ticket.eventId)) map.set(ticket.eventId, []);
    map.get(ticket.eventId).push(ticket);
  }
  return map;
}

export function computeSoldCount(ticketsForEvent) {
  return ticketsForEvent.filter((t) => SOLD_TICKET_STATUSES.has(t.status)).length;
}

export function computeCheckedInCount(ticketsForEvent) {
  return ticketsForEvent.filter((t) => t.status === "USED").length;
}

// Una función se considera "en curso" sólo con datos reales: necesita
// doorsOpenAt ya pasado. Si tiene endAt cargado, ese es el límite exacto; si
// no, se usa el fin del día de `date` como límite razonable (nunca se
// inventa una duración fija de evento).
function isFunctionOngoing(fn, now) {
  if (!fn.doorsOpenAt) return false;
  const opens = new Date(fn.doorsOpenAt);
  if (now < opens) return false;
  if (fn.endAt) return now <= new Date(fn.endAt);
  const endOfDay = new Date(fn.date);
  endOfDay.setHours(23, 59, 59, 999);
  return now <= endOfDay;
}

// Elige qué mostrar en la card grande de arriba: la primera función en curso
// que encuentra entre los eventos PUBLICADOS, o si no hay ninguna, la
// próxima función futura más cercana. Devuelve null si no hay nada que
// mostrar (nunca se inventa un evento).
export function pickFeaturedFunction(events, now) {
  const candidates = [];
  for (const event of events) {
    if (event.status !== "PUBLISHED") continue;
    for (const fn of event.functions ?? []) {
      if (fn.status === "CANCELLED") continue;
      candidates.push({ event, eventFunction: fn });
    }
  }

  const ongoing = candidates.find(({ eventFunction }) => isFunctionOngoing(eventFunction, now));
  if (ongoing) return { ...ongoing, isOngoing: true };

  const upcoming = candidates
    .filter(({ eventFunction }) => new Date(eventFunction.date) >= now)
    .sort((a, b) => new Date(a.eventFunction.date) - new Date(b.eventFunction.date))[0];

  return upcoming ? { ...upcoming, isOngoing: false } : null;
}

// KPIs del "Resumen general" — org-wide, a partir de lo que ya trae el
// contexto. `occupancyPct` es null (no 0) cuando no hay capacidad relevante
// todavía: mostrar 0% ahí sería un dato falso, no uno real.
export function buildOrganizerKpis({ events, tickets, sales }) {
  const revenueTotal = sales
    .filter((s) => s.status === "CONFIRMED")
    .reduce((sum, s) => sum + Number(s.total ?? 0), 0);

  const ticketsSold = tickets.filter((t) => SOLD_TICKET_STATUSES.has(t.status)).length;
  const checkedIn = tickets.filter((t) => t.status === "USED").length;

  const capacityTotal = events
    .filter((e) => CAPACITY_RELEVANT_EVENT_STATUSES.has(e.status))
    .reduce((sum, e) => sum + computeEventCapacity(e), 0);

  const occupancyPct = capacityTotal > 0 ? Math.round((checkedIn / capacityTotal) * 1000) / 10 : null;

  return { revenueTotal, ticketsSold, checkedIn, capacityTotal, occupancyPct };
}

// TicketAuditAction -> tipo de actividad del Timeline. Reusa el texto de
// AUDIT_ACTION_LABEL (ya usado en la pantalla de Entradas) para no tener dos
// vocabularios distintos para la misma acción — incluye la inversión de
// nombres ya documentada ahí: REHABILITATE (CANCELLED->ACTIVE) se etiqueta
// "Reactivada" y REACTIVATE (USED->ACTIVE) se etiqueta "Rehabilitada", tal
// como ya lo ve el organizador en /organizador/entradas.
const AUDIT_ACTION_TYPE = {
  CANCEL: "cancel",
  REHABILITATE: "reactivate",
  REACTIVATE: "rehabilitate",
  MARK_USED_MANUAL: "markUsedManual",
  SOFT_DELETE: "softDelete",
};

// Arma el feed de "Actividad reciente" del evento destacado combinando 3
// fuentes que YA están cargadas — cero consultas nuevas:
// - `sales` (confirmadas) -> "compró".
// - `tickets[].checkIns` (sólo source SCAN — un check-in MANUAL ya lo cubre
//   su propio TicketAuditLog MARK_USED_MANUAL con más detalle; mostrar los
//   dos sería la misma acción dos veces) -> "check-in".
// - `tickets[].auditLogs` -> cancelación/reactivación/rehabilitación/marcado
//   manual/eliminación.
// `scanners` (Fase 2, mismo fetch) sólo aporta "scanner creado" (createdAt).
// NO se emite "scanner deshabilitado": EventScanner no tiene un
// `disabledAt`/`revokedAt` propio, sólo `updatedAt` genérico (se pisa con
// CUALQUIER edición — nombre, puerta, etc.), así que no hay forma de saber
// con certeza que un cambio de `updatedAt` fue una deshabilitación real.
// Mostrarlo igual violaría la regla de no inventar datos.
export function buildActivityFeed({ sales, tickets, scanners, now, limit = 20 }) {
  const items = [];

  for (const sale of sales) {
    if (sale.status !== "CONFIRMED") continue;
    const timestamp = sale.confirmedAt ?? sale.createdAt;
    if (!timestamp) continue;

    const quantity = (sale.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    const buyerName =
      [sale.buyer?.firstName, sale.buyer?.lastName].filter(Boolean).join(" ") || sale.buyer?.email || "Alguien";

    items.push({
      id: `sale-${sale.id}`,
      type: "purchase",
      timestamp,
      title: "Nueva venta",
      description: `${buyerName} compró ${quantity} ${quantity === 1 ? "entrada" : "entradas"}`,
    });
  }

  for (const ticket of tickets) {
    for (const checkIn of ticket.checkIns ?? []) {
      if (checkIn.source !== "SCAN") continue;
      items.push({
        id: `checkin-${checkIn.id}`,
        type: "checkin",
        timestamp: checkIn.scannedAt,
        title: "Check-in validado",
        description: `${checkIn.scannerName ?? "Un scanner"} validó la entrada #${ticket.ticketNumber}`,
      });
    }

    for (const log of ticket.auditLogs ?? []) {
      const type = AUDIT_ACTION_TYPE[log.action];
      if (!type) continue;
      const label = AUDIT_ACTION_LABEL[log.action] ?? log.action;
      items.push({
        id: `audit-${log.id}`,
        type,
        timestamp: log.createdAt,
        title: label,
        description: `Entrada #${ticket.ticketNumber} ${label.toLowerCase()}`,
      });
    }
  }

  for (const scanner of scanners) {
    if (!scanner.createdAt) continue;
    items.push({
      id: `scanner-${scanner.id}`,
      type: "scannerRegistered",
      timestamp: scanner.createdAt,
      title: "Scanner creado",
      description: `Se creó el scanner "${scanner.name}" para la puerta ${scanner.gate}`,
    });
  }

  return items
    .filter((item) => item.timestamp && new Date(item.timestamp) <= now)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}
