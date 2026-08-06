// "Historial de Eventos" — archivado automático, self-heal (sin cron: el
// proyecto no tiene infraestructura de jobs). Cualquier service que liste
// eventos operativos del organizador llama a runArchiveSelfHeal ANTES de su
// propia consulta, y filtra por `archivedAt: null` — así ningún listado
// puede mostrar un evento que ya debería haber pasado al Historial, sin
// necesidad de un proceso en segundo plano.
//
// getFunctionEndBoundary/isFunctionOngoing/getFunctionTemporalState
// duplican (no reutilizan) la misma lógica que ya existe en el frontend
// (pages/organizer/dashboard/dashboardMetrics.js) — no hay forma de
// compartir código entre React y Node en este proyecto tal como está
// armado. Mismo caso ya aceptado con effectiveCapacity (documentado ahí
// mismo). Si alguna vez cambia una, hay que cambiar la otra a mano.

export const ARCHIVE_GRACE_PERIOD_DAYS = 7;
const GRACE_PERIOD_MS = ARCHIVE_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

function getFunctionEndBoundary(fn) {
    if (fn.endAt) return new Date(fn.endAt);
    const endOfDay = new Date(fn.date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
}

function isFunctionOngoing(fn, now) {
    if (!fn.doorsOpenAt) return false;
    const opens = new Date(fn.doorsOpenAt);
    if (now < opens) return false;
    return now <= getFunctionEndBoundary(fn);
}

function getFunctionTemporalState(fn, now) {
    if (isFunctionOngoing(fn, now)) return "ongoing";
    return now > getFunctionEndBoundary(fn) ? "finished" : "upcoming";
}

// Regla de archivado (aprobada):
// - Evento CANCELLED: elegible 7 días después de `cancelledAt`. Un
//   CANCELLED sin cancelledAt (no debería pasar nunca vía
//   updateMyEventService, pero por las dudas) nunca se archiva solo —
//   mejor no archivar de más que archivar con un dato inventado.
// - Evento PUBLISHED/FINISHED: elegible cuando TODAS sus funciones no
//   canceladas están en estado "finished" Y la última en terminar lo hizo
//   hace más de 7 días. Distinto (más estricto) que "pertenece a
//   Finalizados" en el selector del Dashboard, que sólo pide que exista AL
//   MENOS UNA función terminada — acá tienen que estar TODAS, si no un
//   evento recurrente con una fecha futura se archivaría por error.
// - DRAFT/SCHEDULED: nunca se archivan solos (nunca llegaron a operar).
export function isEventEligibleForArchive(event, now) {
    if (event.archivedAt) return false;

    if (event.status === "CANCELLED") {
        if (!event.cancelledAt) return false;
        return now - new Date(event.cancelledAt) >= GRACE_PERIOD_MS;
    }

    if (event.status !== "PUBLISHED" && event.status !== "FINISHED") return false;

    const relevantFunctions = (event.functions ?? []).filter((fn) => fn.status !== "CANCELLED");
    if (relevantFunctions.length === 0) return false;

    let latestEndBoundary = null;
    for (const fn of relevantFunctions) {
        if (getFunctionTemporalState(fn, now) !== "finished") return false;
        const boundary = getFunctionEndBoundary(fn);
        if (!latestEndBoundary || boundary > latestEndBoundary) latestEndBoundary = boundary;
    }

    return now - latestEndBoundary >= GRACE_PERIOD_MS;
}

// Busca eventos de la organización (o uno puntual) que ya cumplen la regla
// de arriba pero todavía no tienen `archivedAt`, y los archiva en un solo
// `updateMany`. Se llama SIEMPRE antes de cualquier listado/lectura
// operativa (ver event.service.js, eventScanner.service.js, sale.service.js,
// ticket.service.js, functionCapacity.service.js) — nunca hace falta un
// cron para que un listado refleje la realidad.
export async function runArchiveSelfHeal(prisma, { organizationId, eventId } = {}, now = new Date()) {
    const where = {
        archivedAt: null,
        status: { in: ["PUBLISHED", "FINISHED", "CANCELLED"] },
        ...(organizationId ? { organizationId } : {}),
        ...(eventId ? { id: eventId } : {}),
    };

    const candidates = await prisma.event.findMany({
        where,
        select: {
            id: true,
            status: true,
            cancelledAt: true,
            archivedAt: true,
            functions: {
                select: { status: true, date: true, doorsOpenAt: true, endAt: true },
            },
        },
    });

    const eligibleIds = candidates.filter((event) => isEventEligibleForArchive(event, now)).map((event) => event.id);

    if (eligibleIds.length > 0) {
        await prisma.event.updateMany({ where: { id: { in: eligibleIds } }, data: { archivedAt: now } });
    }

    return eligibleIds;
}
