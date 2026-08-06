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
