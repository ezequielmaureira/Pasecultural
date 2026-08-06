// Formateadores compartidos para el panel de organizador. Los que ya existían
// (ticketAdminDisplay.js, eventFormat.js, formatDate local de OrganizerScanners)
// se dejan como están — este módulo es el punto de partida para pantallas
// nuevas, no un reemplazo retroactivo de las que ya funcionan.

export function formatCurrencyARS(value) {
  const amount = Number(value ?? 0);
  return amount.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

export function formatShortDate(value) {
  if (!value) return "Fecha a confirmar";
  return new Date(value).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

// "Hace 8 segundos" / "Hace 3 minutos" — para el Timeline de actividad
// (Iteración 1). `now` se recibe como parámetro (no `new Date()` interno)
// para que el caller controle cuándo se recalcula, en vez de que cada
// re-render mueva el reloj por su cuenta.
export function formatRelativeTime(value, now) {
  if (!value) return "";
  const diffSec = Math.max(0, Math.floor((now - new Date(value)) / 1000));

  if (diffSec < 5) return "Hace instantes";
  if (diffSec < 60) return `Hace ${diffSec} segundos`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} ${diffMin === 1 ? "minuto" : "minutos"}`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `Hace ${diffHour} ${diffHour === 1 ? "hora" : "horas"}`;

  const diffDay = Math.floor(diffHour / 24);
  return `Hace ${diffDay} ${diffDay === 1 ? "día" : "días"}`;
}
