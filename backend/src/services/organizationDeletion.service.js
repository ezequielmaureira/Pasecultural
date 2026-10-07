import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { isFunctionFinished } from "./eventArchive.service.js";

// Hard delete de una Organization eliminada voluntariamente por su
// propietario, con antecedente histórico en DeletedOrganization. Lo usan
// deleteMyOrganizationService (organization.service.js) y el script de
// conversión de las organizaciones cerradas con el mecanismo viejo
// (scripts/convertClosedOrganizations.js) — un único camino.
//
// Todo recibe `client` (siempre el `tx` de una $transaction interactiva):
// nunca puede quedar un estado parcial (antecedente creado pero
// Organization viva, eventos desacoplados sin antecedente, etc.).
//
// Qué se BORRA:
//   - la Organization;
//   - sus filas operativas (Mercado Pago, WhatsApp, verificación de
//     teléfono, notificaciones, conversaciones/selecciones de WhatsApp);
//   - los eventos SIN historial (ninguna Sale, Ticket ni solicitud de
//     arrepentimiento, ni siquiera soft-deleted) — sus funciones, tipos de
//     entrada, links y scanners se van por el cascade ya existente.
// Qué se CONSERVA:
//   - el User propietario (y Clerk, que acá ni se toca);
//   - los eventos CON historial, desacoplados (organizationId null,
//     deletedOrganizationId = antecedente) y archivados (archivedAt);
//   - todas sus Sales/Tickets/QR/check-ins/auditoría/cortesías/solicitudes,
//     sin modificar una sola fila de esas tablas.

export const OrganizationDeletionBlocker = Object.freeze({
    PENDING_SALES: "PENDING_SALES",
    UPCOMING_ACTIVE_TICKETS: "UPCOMING_ACTIVE_TICKETS",
    OPEN_WITHDRAWAL_REQUESTS: "OPEN_WITHDRAWAL_REQUESTS",
});

const OPEN_WITHDRAWAL_STATUSES = ["REQUESTED", "CONTACTED"];

function plural(count, singular, pluralForm) {
    return count === 1 ? singular : pluralForm;
}

function buildBlockerMessage(code, count) {
    switch (code) {
        case OrganizationDeletionBlocker.PENDING_SALES:
            return `Tenés ${count} ${plural(count, "venta pendiente", "ventas pendientes")} de pago o confirmación. Confirmalas o cancelalas desde Ventas.`;
        case OrganizationDeletionBlocker.UPCOMING_ACTIVE_TICKETS:
            return `Hay ${count} ${plural(count, "entrada activa", "entradas activas")} para funciones que todavía no terminaron. Esperá a que finalicen o resolvé esas entradas (por ejemplo, cancelándolas y gestionando la devolución).`;
        case OrganizationDeletionBlocker.OPEN_WITHDRAWAL_REQUESTS:
            return `Hay ${count} ${plural(count, "solicitud de arrepentimiento abierta", "solicitudes de arrepentimiento abiertas")}. Resolvelas o descartalas antes de eliminar.`;
        default:
            return "Hay operaciones pendientes con compradores.";
    }
}

// Obligaciones VIVAS con compradores que quedarían rotas al eliminar la
// organización (al borrarse su conexión de Mercado Pago ya no se podría
// confirmar ni reconciliar un pago, y nadie administraría las entradas).
// Las ventas/entradas HISTÓRICAS (funciones ya terminadas, ventas ya
// confirmadas/canceladas, solicitudes resueltas) nunca bloquean.
//   - Sale PENDING (cualquier medio, no soft-deleted): un pago todavía
//     puede llegar o estar perdido — reconciliación y "Pagué pero no
//     recibí mis entradas" dependen de la conexión de la organización.
//   - Ticket ACTIVE de una función que todavía no terminó (misma regla
//     isFunctionFinished que usa el archivado/escaneo).
//   - WithdrawalRequest REQUESTED/CONTACTED.
export async function findOrganizationDeletionBlockers(client, organizationId, now = new Date()) {
    const [pendingSales, functionsWithActiveTickets, openWithdrawals] = await Promise.all([
        client.sale.count({
            where: { status: "PENDING", deletedAt: null, event: { organizationId } },
        }),
        client.eventFunction.findMany({
            where: {
                event: { organizationId },
                tickets: { some: { status: "ACTIVE", deletedAt: null } },
            },
            select: {
                date: true,
                doorsOpenAt: true,
                endAt: true,
                _count: { select: { tickets: { where: { status: "ACTIVE", deletedAt: null } } } },
            },
        }),
        client.withdrawalRequest.count({
            where: { organizationId, status: { in: OPEN_WITHDRAWAL_STATUSES } },
        }),
    ]);

    const upcomingActiveTickets = functionsWithActiveTickets
        .filter((fn) => !isFunctionFinished(fn, now))
        .reduce((sum, fn) => sum + fn._count.tickets, 0);

    const counts = [
        [OrganizationDeletionBlocker.PENDING_SALES, pendingSales],
        [OrganizationDeletionBlocker.UPCOMING_ACTIVE_TICKETS, upcomingActiveTickets],
        [OrganizationDeletionBlocker.OPEN_WITHDRAWAL_REQUESTS, openWithdrawals],
    ];

    return counts
        .filter(([, count]) => count > 0)
        .map(([code, count]) => ({ code, count, message: buildBlockerMessage(code, count) }));
}

export function buildDeletedOrganizationSnapshot(organization, owner, { reason, deletedAt }) {
    return {
        originalOrganizationId: organization.id,
        name: organization.name,
        logo: organization.logo ?? null,
        email: organization.email,
        plan: organization.plan,
        type: organization.type ?? null,
        city: organization.city ?? null,
        province: organization.province ?? null,
        responsibleFirstName: organization.responsibleFirstName ?? null,
        responsibleLastName: organization.responsibleLastName ?? null,
        ownerId: owner?.id ?? organization.ownerId ?? null,
        ownerFirstName: owner?.firstName ?? null,
        ownerLastName: owner?.lastName ?? null,
        ownerEmail: owner?.email ?? null,
        // El mecanismo viejo pisaba status con SUSPENDED al cerrar; para esas
        // filas el estado "original" real ya no existe — se guarda el que hay.
        originalStatus: organization.status,
        originalCreatedAt: organization.createdAt,
        approvedAt: organization.approvedAt ?? null,
        deletedAt,
        reason,
    };
}

function eventHasHistory(event) {
    const { sales, tickets, withdrawalRequests } = event._count;
    return sales > 0 || tickets > 0 || withdrawalRequests > 0;
}

// `organization` = fila completa de Organization; `owner` = User propietario.
// Lanza ORGANIZATION_DELETE_BLOCKED (con `details` = bloqueos) si aparecen
// obligaciones vivas — evaluadas DENTRO de la transacción, después de
// bloquear la organización y sus eventos. `deletedAt` (default `now`) es la
// fecha que queda en el antecedente: el script de conversión pasa el
// closedAt original de las organizaciones cerradas con el mecanismo viejo.
export async function hardDeleteOrganization(
    client,
    organization,
    owner,
    { reason = "DELETED_BY_USER", now = new Date(), deletedAt = now } = {}
) {
    const organizationId = organization.id;

    // Locks: la fila de Organization serializa dos eliminaciones
    // concurrentes; FOR UPDATE sobre sus eventos choca con el FOR KEY SHARE
    // que toma cualquier INSERT de Sale/Ticket/solicitud sobre esos eventos
    // (chequeo de FK), así que ninguna venta nueva puede colarse entre el
    // chequeo de bloqueos y el desacople.
    await client.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
    await client.$queryRaw`SELECT "id" FROM "Event" WHERE "organizationId" = ${organizationId} FOR UPDATE`;

    const blockers = await findOrganizationDeletionBlockers(client, organizationId, now);
    if (blockers.length > 0) {
        throw new AppError(ErrorCodes.ORGANIZATION_DELETE_BLOCKED, { details: blockers });
    }

    const snapshot = await client.deletedOrganization.create({
        data: buildDeletedOrganizationSnapshot(organization, owner, { reason, deletedAt }),
    });

    const events = await client.event.findMany({
        where: { organizationId },
        select: {
            id: true,
            // Sin filtro de deletedAt a propósito: una Sale/Ticket
            // soft-deleted sigue existiendo y sigue bloqueando el borrado
            // físico del evento por FK — ese evento se conserva.
            _count: { select: { sales: true, tickets: true, withdrawalRequests: true } },
        },
    });
    const historicalEventIds = events.filter(eventHasHistory).map((e) => e.id);
    const disposableEventIds = events.filter((e) => !eventHasHistory(e)).map((e) => e.id);

    if (disposableEventIds.length > 0) {
        // Cascade ya existente: EventLink, EventFunction, TicketType,
        // FunctionTicketType, EventScanner. Ninguno tiene ventas/tickets.
        await client.event.deleteMany({ where: { id: { in: disposableEventIds } } });
    }

    if (historicalEventIds.length > 0) {
        // Archivado = concepto ya existente (Historial de Eventos,
        // eventArchive.service.js). Nunca se toca `status`: un evento que
        // ocurrió normalmente no pasa a CANCELLED.
        await client.event.updateMany({
            where: { id: { in: historicalEventIds }, archivedAt: null },
            data: { archivedAt: now },
        });
        await client.event.updateMany({
            where: { id: { in: historicalEventIds } },
            data: { organizationId: null, deletedOrganizationId: snapshot.id },
        });
        // Scanners de esos eventos: dejan de tener acceso (todos los
        // resolvers de scanner exigen deletedAt null).
        await client.eventScanner.updateMany({
            where: { eventId: { in: historicalEventIds }, deletedAt: null },
            data: { deletedAt: now },
        });
    }

    await client.withdrawalRequest.updateMany({
        where: { organizationId },
        data: { organizationId: null, deletedOrganizationId: snapshot.id },
    });

    // Filas operativas — no tienen valor histórico para compradores.
    await client.mercadoPagoOAuthState.deleteMany({ where: { organizationId } });
    await client.mercadoPagoConnection.deleteMany({ where: { organizationId } });
    await client.whatsappOrganizerLink.deleteMany({ where: { organizationId } });
    await client.whatsappNumberChangeChallenge.deleteMany({ where: { organizationId } });
    await client.organizationPhoneVerification.deleteMany({ where: { organizationId } });
    await client.organizationPhoneChangeAuthorization.deleteMany({ where: { organizationId } });
    await client.organizerNotificationSettings.deleteMany({ where: { organizationId } });
    // Sin FK (strings/JSON) — se limpian para que ningún flujo de WhatsApp
    // retome una conversación o selección apuntando a un id inexistente.
    await client.conversationState.deleteMany({ where: { organizationId } });
    await client.whatsappPendingOrganizationSelection.deleteMany({
        where: {
            OR: [{ selectedOrganizationId: organizationId }, { candidateOrganizationIds: { array_contains: [organizationId] } }],
        },
    });

    await client.organization.delete({ where: { id: organizationId } });

    return {
        deletedOrganization: snapshot,
        deletedEventIds: disposableEventIds,
        archivedEventIds: historicalEventIds,
    };
}
