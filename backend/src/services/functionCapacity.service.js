// Única definición de "cuánta capacidad tiene un TicketType para una
// función puntual" de toda la app: override de la función si existe, si no
// el quantity del catálogo. Antes vivía duplicada dos veces dentro de
// sale.service.js (createSale/confirmSale) — se extrajo acá y sale.service
// pasa a importarla, igual que el dominio de scanner.
export function effectiveCapacity(assignment) {
    return assignment.quantityOverride ?? assignment.ticketType.quantity;
}

// Trae, para una función, sólo las asignaciones habilitadas (las que
// realmente cuentan como capacidad vendible) con lo mínimo necesario para
// calcular capacidad: ticketTypeId, nombre, y el override/quantity.
async function getFunctionCapacityAssignments(client, functionId) {
    const assignments = await client.functionTicketType.findMany({
        where: { functionId, enabled: true },
        select: {
            ticketTypeId: true,
            quantityOverride: true,
            ticketType: { select: { name: true, quantity: true } },
        },
    });

    return assignments.map((a) => ({
        ticketTypeId: a.ticketTypeId,
        name: a.ticketType.name,
        capacity: effectiveCapacity(a),
    }));
}

// Versión liviana: sólo los 3 números totales, sin desglose por tipo de
// entrada. Es la que usa validate() en cada scan (hot path) — un count()
// agregado, no un groupBy, porque acá no hace falta el desglose.
export async function getFunctionCounters(client, functionId) {
    const [assignments, checkedIn] = await Promise.all([
        getFunctionCapacityAssignments(client, functionId),
        client.ticket.count({ where: { functionId, status: "USED" } }),
    ]);

    const capacity = assignments.reduce((sum, a) => sum + a.capacity, 0);
    return { capacity, checkedIn, remaining: Math.max(capacity - checkedIn, 0) };
}

// Versión completa: totales + desglose por TicketType (nombres libres del
// organizador, sin categorías fijas). Un groupBy agregado en vez de un
// count() por tipo de entrada — sigue siendo O(1) queries sin importar
// cuántos tickets tenga la función.
export async function getFunctionStats(client, functionId) {
    const [assignments, checkedInGroups] = await Promise.all([
        getFunctionCapacityAssignments(client, functionId),
        client.ticket.groupBy({
            by: ["ticketTypeId"],
            where: { functionId, status: "USED" },
            _count: { _all: true },
        }),
    ]);

    const checkedInByType = new Map(checkedInGroups.map((g) => [g.ticketTypeId, g._count._all]));

    const byTicketType = assignments.map((a) => {
        const checkedIn = checkedInByType.get(a.ticketTypeId) ?? 0;
        return {
            ticketTypeId: a.ticketTypeId,
            name: a.name,
            capacity: a.capacity,
            checkedIn,
            remaining: Math.max(a.capacity - checkedIn, 0),
        };
    });

    const totals = byTicketType.reduce(
        (acc, t) => ({ capacity: acc.capacity + t.capacity, checkedIn: acc.checkedIn + t.checkedIn }),
        { capacity: 0, checkedIn: 0 }
    );

    return {
        capacity: totals.capacity,
        checkedIn: totals.checkedIn,
        remaining: Math.max(totals.capacity - totals.checkedIn, 0),
        byTicketType,
    };
}
