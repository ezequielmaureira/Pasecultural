// Mapas de texto/color compartidos entre OrganizerTickets.jsx (tabla) y
// TicketDetailDrawer.jsx (detalle) — evita repetir los mismos mapas en los
// dos archivos. Nunca cambia los valores reales del enum (Ticket.status,
// TicketAuditAction, CheckIn.source), sólo cómo se muestran.

export const TICKET_STATUS_LABEL = {
  ACTIVE: "Disponible",
  USED: "Utilizada",
  CANCELLED: "Cancelada",
  REFUNDED: "Reintegrada",
};

export const TICKET_STATUS_BADGE_TONE = {
  ACTIVE: "bg-emerald-500/10 text-emerald-400",
  USED: "bg-white/10 text-slate-300",
  CANCELLED: "bg-rose-500/10 text-rose-400",
  REFUNDED: "bg-amber-500/10 text-amber-400",
};

const DELETED_BADGE_TONE = "bg-white/5 text-slate-500";

export function ticketStatusLabel(ticket) {
  return ticket.deletedAt ? "Eliminada" : (TICKET_STATUS_LABEL[ticket.status] ?? ticket.status);
}

export function ticketStatusBadgeTone(ticket) {
  return ticket.deletedAt ? DELETED_BADGE_TONE : (TICKET_STATUS_BADGE_TONE[ticket.status] ?? "bg-white/10 text-slate-300");
}

export const CHECKIN_SOURCE_LABEL = { SCAN: "Escaneo", MANUAL: "Manual" };

// CANCEL/REHABILITATE/REACTIVATE/MARK_USED_MANUAL/SOFT_DELETE son los
// nombres reales del enum TicketAuditAction (backend, sin tocar acá) — ver
// ticketAdminApi.js para la aclaración de por qué REHABILITATE es
// CANCELLED->ACTIVE y REACTIVATE es USED->ACTIVE (al revés de como se
// nombran los botones en esta pantalla).
export const AUDIT_ACTION_LABEL = {
  CANCEL: "Cancelada",
  REHABILITATE: "Reactivada",
  REACTIVATE: "Rehabilitada",
  MARK_USED_MANUAL: "Marcada utilizada manualmente",
  SOFT_DELETE: "Eliminada",
};

export const AUDIT_ACTOR_TYPE_LABEL = { ORGANIZER: "Organizador", SCANNER: "Scanner", SYSTEM: "Sistema" };

export function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("es-AR", { dateStyle: "long" });
}
