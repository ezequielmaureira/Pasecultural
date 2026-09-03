-- Optimización de lectura para GET /api/events/public/:slug (auditoría de
-- performance). Sólo CREATE INDEX — ninguna de estas columnas cambia de
-- tipo, ningún dato se toca, cero impacto semántico.

-- event_functions.eventId / ticket_types.eventId / event_links.eventId no
-- tenían ningún índice (ni explícito ni implícito vía @@unique compuesto
-- que empiece por eventId) — el filtrado por evento (incluido dentro de
-- PUBLIC_EVENT_DETAIL_INCLUDE) hacía sequential scan sobre estas 3 tablas.
CREATE INDEX "event_functions_eventId_idx" ON "event_functions"("eventId");
CREATE INDEX "ticket_types_eventId_idx" ON "ticket_types"("eventId");
CREATE INDEX "event_links_eventId_idx" ON "event_links"("eventId");

-- tickets no tenía ningún @@index. Soporta exactamente el groupBy de
-- attachTicketAvailability (event.service.js):
--   prisma.ticket.groupBy({
--     by: ["ticketTypeId", "functionId"],
--     where: { functionId: { in: functionIds }, status: { in: SOLD_TICKET_STATUSES } },
--     _count: { _all: true },
--   })
-- Orden de columnas: functionId primero (filtro IN de mayor selectividad,
-- siempre acotado a las funciones de UN evento), status segundo (también
-- IN, sobre el subconjunto ya restringido por functionId), ticketTypeId al
-- final para que el índice cubra también la columna de agrupación sin
-- volver a la tabla (index-only scan para este groupBy).
CREATE INDEX "tickets_functionId_status_ticketTypeId_idx" ON "tickets"("functionId", "status", "ticketTypeId");
