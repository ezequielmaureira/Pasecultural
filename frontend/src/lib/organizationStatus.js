export const ORG_STATUS_LABEL = {
  PENDING: "Pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  SUSPENDED: "Suspendida",
  // Estado sintético de las filas históricas (DeletedOrganization) — no es
  // un OrganizationStatus real y no tiene filtro propio: sólo aparece en
  // "Todas" y nunca admite cambios de estado.
  DELETED_BY_USER: "Eliminada por usuario",
};

export const ORG_STATUS_STYLES = {
  PENDING: "bg-amber-500/10 text-amber-400",
  APPROVED: "bg-emerald-500/10 text-emerald-400",
  REJECTED: "bg-rose-500/10 text-rose-400",
  SUSPENDED: "bg-red-500/10 text-red-400",
  DELETED_BY_USER: "bg-white/10 text-slate-400",
};

export const ORG_STATUS_FILTERS = [
  { id: "ALL", label: "Todas" },
  { id: "PENDING", label: "Pendientes" },
  { id: "APPROVED", label: "Aprobadas" },
  { id: "REJECTED", label: "Rechazadas" },
  { id: "SUSPENDED", label: "Suspendidas" },
];

// Nombre de organización para tablas Developer (eventos/ventas/tickets/
// scanners): un evento histórico de una organización eliminada por su
// propietario trae el nombre del antecedente con `deleted: true`.
export function organizationDisplayName(organization) {
  if (!organization) return "—";
  return organization.deleted ? `${organization.name} (eliminada)` : organization.name;
}
