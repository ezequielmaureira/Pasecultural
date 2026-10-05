// Helper mínimo para no repetir el mismo template string en cada card que
// linkea a "administrar evento" (EventHeroCard, EventStatusCard).
export function eventEditPath(eventId) {
  return `/organizador/eventos/${eventId}/editar`;
}

// Destino de "Ver resumen" en el Historial de Eventos — informe final de
// solo lectura (OrganizerEventHistoryDetail.jsx), distinto del wizard de
// edición de arriba (ver el informe de la ronda "Historial de Eventos
// completo").
export function eventHistoryDetailPath(eventId) {
  return `/organizador/historial/${eventId}`;
}
