export const ORG_STATUS_LABEL = {
  PENDING: "Pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  SUSPENDED: "Suspendida",
};

export const ORG_STATUS_STYLES = {
  PENDING: "bg-amber-500/10 text-amber-400",
  APPROVED: "bg-emerald-500/10 text-emerald-400",
  REJECTED: "bg-rose-500/10 text-rose-400",
  SUSPENDED: "bg-red-500/10 text-red-400",
};

export const ORG_STATUS_FILTERS = [
  { id: "ALL", label: "Todas" },
  { id: "PENDING", label: "Pendientes" },
  { id: "APPROVED", label: "Aprobadas" },
  { id: "REJECTED", label: "Rechazadas" },
  { id: "SUSPENDED", label: "Suspendidas" },
];
