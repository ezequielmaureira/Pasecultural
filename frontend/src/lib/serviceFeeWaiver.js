// Beneficio para compradores (cargo de servicio Smarticket $0) — sólo para
// MOSTRAR. Misma regla que
// backend/src/services/serviceFeeWaiver.service.js#getServiceFeeWaiverStatus;
// quién paga cargo lo decide siempre el backend.
//
// "NOT_STARTED" (nunca publicó) | "ACTIVE" | "EXPIRED" | "NONE" (publicó
// con la promoción inicial desactivada y nunca se le otorgó una).
export function getServiceFeeWaiverStatus(organization, now = new Date()) {
  const until = organization?.serviceFeeWaivedUntil;
  if (!until) return organization?.firstEventPublishedAt ? "NONE" : "NOT_STARTED";
  return now.getTime() < new Date(until).getTime() ? "ACTIVE" : "EXPIRED";
}

// DD/MM/YYYY en hora argentina (los meses calendario se calculan en esa zona).
export function formatWaiverDate(value) {
  return new Date(value).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// "1 mes" / "2 meses" — la duración sale de Developer > Configuración
// (service_fee_settings), nunca escrita en el frontend.
export function formatMonths(months) {
  return months === 1 ? "1 mes" : `${months} meses`;
}

// "un mes" / "2 meses" — para frases ("durante un mes").
export function formatMonthsInWords(months) {
  return months === 1 ? "un mes" : `${months} meses`;
}
