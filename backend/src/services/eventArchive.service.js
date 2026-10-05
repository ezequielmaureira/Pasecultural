import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";

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
//
// Regla "evento finalizado = evento finalizado" (ronda EVENT_FINISHED_GUARD)
// — reutiliza EXACTAMENTE este mismo cálculo (getFunctionEndBoundary/
// getFunctionTemporalState, ya validado por el archivado automático) para
// decidir si una EventFunction puntual sigue aceptando operaciones nuevas.
// A propósito es por-FUNCIÓN, no por-Event: un Event recurrente con una
// función ya pasada y otra futura sigue operativo para la función futura —
// bloquear a nivel Event entero sería más estricto de lo que el modelo de
// datos (Sale/Ticket atados a functionId) necesita. Ver isEventEligibleForArchive
// más abajo para el criterio (más estricto, TODAS las funciones) que sí es
// a nivel Event completo, usado sólo para archivar.
export { getFunctionEndBoundary, getFunctionTemporalState };

// Sólo se usa para CANCELLED (ver isEventEligibleForArchive) — los eventos
// finalizados (PUBLISHED/FINISHED/DRAFT con todas sus funciones terminadas)
// ya NO esperan ningún grace period, se archivan inmediatamente.
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

// Único punto de verdad de "¿esta función ya finalizó?" para guards de
// negocio (distinto de isEventEligibleForArchive, que decide archivado).
export function isFunctionFinished(fn, now = new Date()) {
    return getFunctionTemporalState(fn, now) === "finished";
}

// Guard reutilizable — lanza AppError(EVENT_FINISHED) si la función ya
// terminó. `fn` necesita al menos { date, doorsOpenAt, endAt }. Usado por
// createSaleForBuyer (sale.service.js) y markTicketUsedManuallyService
// (ticketAdmin.service.js). El escaneo por QR (scanner.service.js) usa
// isFunctionFinished directamente porque ahí un resultado de negocio nunca
// es una excepción (ver resolveScanOutcome).
export function assertFunctionActive(fn, now = new Date()) {
    if (isFunctionFinished(fn, now)) {
        throw new AppError(ErrorCodes.EVENT_FINISHED);
    }
}

// Regla de archivado (ronda "eventos finalizados a Historial" — ya NO
// hay grace period para eventos finalizados, ver el informe de la ronda):
// - Evento CANCELLED: sigue elegible 7 días después de `cancelledAt`, sin
//   cambios — esta ronda es específicamente sobre eventos que YA
//   TERMINARON, no sobre cancelados. Un CANCELLED sin cancelledAt (no
//   debería pasar nunca vía updateMyEventService, pero por las dudas)
//   nunca se archiva solo — mejor no archivar de más que archivar con un
//   dato inventado.
// - Evento PUBLISHED/FINISHED/DRAFT: elegible INMEDIATAMENTE apenas TODAS
//   sus funciones no canceladas están en estado "finished" — sin esperar
//   ninguna ventana adicional. DRAFT se incluyó a propósito (antes nunca
//   se archivaba solo): un borrador con una función de hace un mes no
//   tiene sentido operativo, el Organizer ya no puede hacer nada con él
//   salvo consultarlo — pertenece al Historial igual que un evento
//   publicado ya terminado. Un DRAFT sin funciones (relevantFunctions
//   vacío) sigue sin archivarse: todavía es un borrador en preparación,
//   nunca "ya terminó". Distinto (más estricto) que "pertenece a
//   Finalizados" en el selector del Dashboard, que sólo pide que exista AL
//   MENOS UNA función terminada — acá tienen que estar TODAS, si no un
//   evento recurrente con una función pasada y otra futura se archivaría
//   por error mientras todavía tiene una función operativa por delante.
// - SCHEDULED: Event.status nunca llega a valer esto en la práctica (es
//   EventFunction.status el que usa "SCHEDULED", un enum distinto) — se
//   deja afuera de los estados elegibles por las dudas, sin cambios.
export function isEventEligibleForArchive(event, now) {
    if (event.archivedAt) return false;

    if (event.status === "CANCELLED") {
        if (!event.cancelledAt) return false;
        return now - new Date(event.cancelledAt) >= GRACE_PERIOD_MS;
    }

    if (event.status !== "PUBLISHED" && event.status !== "FINISHED" && event.status !== "DRAFT") return false;

    const relevantFunctions = (event.functions ?? []).filter((fn) => fn.status !== "CANCELLED");
    if (relevantFunctions.length === 0) return false;

    return relevantFunctions.every((fn) => getFunctionTemporalState(fn, now) === "finished");
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
        status: { in: ["PUBLISHED", "FINISHED", "CANCELLED", "DRAFT"] },
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
