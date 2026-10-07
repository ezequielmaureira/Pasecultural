// Organización "para mostrar" de un evento: la Organization viva o, para un
// evento histórico de una organización eliminada por su propietario
// (organizationId null), el antecedente DeletedOrganization. Sólo para
// lecturas/listados — nunca para decidir permisos.
export const EVENT_ORGANIZATION_LABEL_SELECT = {
    organization: { select: { id: true, name: true } },
    deletedOrganization: { select: { id: true, name: true } },
};

export function resolveEventOrganization(event) {
    if (event?.organization) return event.organization;
    if (event?.deletedOrganization) {
        return { id: null, name: event.deletedOrganization.name, deleted: true };
    }
    return null;
}
