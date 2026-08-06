// "Semáforo" de salud de un scanner — pensado para leerse en menos de 5
// segundos (verde/amarillo/rojo/gris). Usa exclusivamente datos reales:
// `scanner.status` (EventScannerStatus) y `scanner.lastScanAt` (calculado en
// el backend desde CheckIn.scannedAt — ver eventScanner.service.js; nunca la
// columna EventScanner.lastScanAt, que nadie escribe).
const FRESH_WINDOW_MS = 5 * 60 * 1000; // 5 minutos

export function getScannerHealth(scanner, now) {
  if (scanner.status === "DISABLED" || scanner.status === "REVOKED") {
    return { level: "disabled", tone: "danger", label: "Deshabilitado" };
  }

  if (!scanner.lastScanAt) {
    return { level: "idle", tone: "neutral", label: "Sin escaneos todavía" };
  }

  const elapsedMs = now - new Date(scanner.lastScanAt);
  if (elapsedMs <= FRESH_WINDOW_MS) {
    return { level: "active", tone: "success", label: "Actividad reciente" };
  }

  return { level: "stale", tone: "warning", label: "Sin actividad hace unos minutos" };
}

// Estado formal (ciclo de vida) — separado de la "salud" de arriba a
// propósito: un scanner puede estar ACTIVE (estado) y sin embargo "stale"
// (salud) porque hace rato no escanea nada.
export const SCANNER_LIFECYCLE_LABEL = {
  INVITED: "Invitado, sin registrar",
  ACTIVE: "Activo",
  DISABLED: "Deshabilitado",
  REVOKED: "Revocado",
};
