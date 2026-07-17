/**
 * Reglas de confianza sobre Organización, espejo de la regla del backend.
 * Punto único de verdad en el frontend: si se agregan reglas automáticas
 * a futuro, se ajustan acá sin tocar las pantallas de Event.
 */
export function canPublishEvents(organization) {
  return organization?.status === "APPROVED";
}
