// Cómo se ve/lee cada TicketStatus en las pantallas públicas sin sesión
// (hoy: WithdrawalTicketDetailModal.jsx) — evita que cada componente arme
// su propio texto/color y que se desincronicen.
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
