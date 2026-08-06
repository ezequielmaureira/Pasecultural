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

// Límite de "todavía no terminó" de una función: endAt si está cargado, si
// no el fin del día de `date` (nunca se inventa una duración fija de
// evento). Extraído aparte porque isFunctionOngoing Y
// getFunctionTemporalState necesitan exactamente el mismo límite — así no
// hay forma de que una función quede "ongoing" para una y "finished" para
// la otra por una diferencia de cálculo.
function getFunctionEndBoundary(fn) {
  if (fn.endAt) return new Date(fn.endAt);
  const endOfDay = new Date(fn.date);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay;
}

// Una función se considera "en curso" sólo con datos reales: necesita
// doorsOpenAt ya pasado. Comportamiento idéntico al de antes de extraer
// getFunctionEndBoundary — mismo resultado para los mismos datos.
function isFunctionOngoing(fn, now) {
  if (!fn.doorsOpenAt) return false;
  const opens = new Date(fn.doorsOpenAt);
  if (now < opens) return false;
  return now <= getFunctionEndBoundary(fn);
}

// "ongoing" | "upcoming" | "finished" — la única fuente de verdad de en qué
// categoría cae una función puntual, reusada tanto por groupEventsByCategory
// como por cualquier otro lado que necesite lo mismo.
function getFunctionTemporalState(fn, now) {
  if (isFunctionOngoing(fn, now)) return "ongoing";
  return now > getFunctionEndBoundary(fn) ? "finished" : "upcoming";
}

// Agrupa los eventos del organizador en las 3 categorías del selector del
// Dashboard. Un evento "cuenta" con el mismo criterio que ya usaba
// CAPACITY_RELEVANT_EVENT_STATUSES (PUBLISHED o FINISHED — nunca
// DRAFT/SCHEDULED/CANCELLED). Un mismo evento puede aparecer en más de una
// categoría a la vez si tiene funciones en estados distintos (ej. un evento
// recurrente con una función ya pasada y otra todavía programada) — es
// correcto, no un bug: cada categoría muestra su propia función
// representativa de ESE evento (la que está en curso, la próxima más
// cercana, o la última que ya terminó).
export function groupEventsByCategory(events, now) {
  const byEventOngoing = new Map();
  const byEventUpcoming = new Map();
  const byEventFinished = new Map();

  for (const event of events) {
    if (!CAPACITY_RELEVANT_EVENT_STATUSES.has(event.status)) continue;

    for (const fn of event.functions ?? []) {
      if (fn.status === "CANCELLED") continue;

      const state = getFunctionTemporalState(fn, now);
      const candidate = { event, eventFunction: fn };

      if (state === "ongoing") {
        // Si un evento tiene más de una función simultánea "en curso"
        // (raro, pero posible), se queda con la primera que encuentra — no
        // hace falta desempatar más fino que eso para esta pantalla.
        if (!byEventOngoing.has(event.id)) byEventOngoing.set(event.id, candidate);
      } else if (state === "upcoming") {
        const current = byEventUpcoming.get(event.id);
        if (!current || new Date(fn.date) < new Date(current.eventFunction.date)) {
          byEventUpcoming.set(event.id, candidate); // la próxima más cercana
        }
      } else {
        const current = byEventFinished.get(event.id);
        if (!current || new Date(fn.date) > new Date(current.eventFunction.date)) {
          byEventFinished.set(event.id, candidate); // la última en terminar
        }
      }
    }
  }

  const byDateAsc = (a, b) => new Date(a.eventFunction.date) - new Date(b.eventFunction.date);
  const byDateDesc = (a, b) => new Date(b.eventFunction.date) - new Date(a.eventFunction.date);

  return {
    ongoing: [...byEventOngoing.values()].sort(byDateAsc),
    upcoming: [...byEventUpcoming.values()].sort(byDateAsc),
    // Finalizados: el más reciente primero (lo más relevante de "lo que ya
    // pasó" suele ser lo último que pasó, no lo más viejo).
    finished: [...byEventFinished.values()].sort(byDateDesc),
  };
}

// Busca en qué categoría (y en qué posición) aparece un evento puntual —
// usado para que el Dashboard respete el Evento Activo compartido (ver
// ActiveEventContext) como punto de partida, en vez de siempre priorizar
// ongoing > upcoming > finished. Devuelve null si el evento no aparece en
// ninguna categoría (ej. está archivado, o no existe).
export function findEventCategoryPosition(categorized, eventId) {
  if (!eventId) return null;
  for (const category of ["ongoing", "upcoming", "finished"]) {
    const index = categorized[category].findIndex((candidate) => candidate.event.id === eventId);
    if (index !== -1) return { category, index };
  }
  return null;
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
