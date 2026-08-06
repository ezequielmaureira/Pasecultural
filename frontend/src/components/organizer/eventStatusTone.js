// Traduce Event.status a un tono de Badge — mismo mapeo de color que ya usa
// EVENT_STATUS_STYLES (lib/eventStatus.js), pero expresado como tono en vez
// de className cruda, para poder usar el Badge genérico. Reutiliza
// EVENT_STATUS_LABEL de ese mismo archivo para el texto, no lo duplica.
export const EVENT_STATUS_TONE = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  PUBLISHED: "success",
  CANCELLED: "danger",
  FINISHED: "warning",
};
