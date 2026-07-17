/**
 * Reglas de confianza sobre Organización.
 * Punto único de verdad: si en el futuro se agregan reglas automáticas
 * (antigüedad, reincidencia, etc.) se ajustan acá sin tocar el flujo de Event.
 */
export function canPublishEvents(organization) {
    return organization?.status === "APPROVED";
}
