// Única fuente de verdad de cómo se ve/lee cada TicketStatus en toda la
// pantalla de Mis Entradas (card, modal de detalle, modal de QR) — evita
// que cada componente arme su propio texto/color y que se desincronicen.
export const TICKET_STATUS_LABEL = {
    ACTIVE: "Activa",
    USED: "Utilizada",
    CANCELLED: "Cancelada",
    REFUNDED: "Reembolsada",
};

export const TICKET_STATUS_TONE = {
    ACTIVE: "bg-emerald-500/10 text-emerald-400",
    USED: "bg-white/10 text-slate-400",
    CANCELLED: "bg-rose-500/10 text-rose-400",
    REFUNDED: "bg-amber-500/10 text-amber-400",
};

export function formatEventDate(dateValue) {
    if (!dateValue) return "Fecha a confirmar";
    return new Date(dateValue).toLocaleDateString("es-AR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
    });
}

export function formatEventTime(dateValue) {
    if (!dateValue) return null;
    return new Date(dateValue).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
    });
}
