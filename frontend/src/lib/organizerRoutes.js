// Helper mínimo para no repetir el mismo template string en cada card que
// linkea a "administrar evento" (EventHeroCard, EventStatusCard).
export function eventEditPath(eventId) {
  return `/organizador/eventos/${eventId}/editar`;
}
