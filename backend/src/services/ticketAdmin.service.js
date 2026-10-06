import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getOwnedEvent } from "./eventScanner.service.js";
import { assertFunctionActive } from "./eventArchive.service.js";
import { getWithdrawalReturnInfoForTickets } from "./withdrawalRequest.service.js";

// Administración de entradas por el organizador dueño del evento — 5
// operaciones sobre Ticket.status, cada una con su transición permitida y
// su fila de TicketAuditLog (nunca se actualiza/borra un ticket sin dejar
// ese rastro). Mismo criterio de autorización que eventScanner.service.js
// (getOwnedEvent, reusado tal cual): "no es tuyo" y "no existe" responden
// igual (EVENT_NOT_FOUND / TICKET_NOT_FOUND), sin distinguir uno de otro.

async function findOwnedTicket(eventId, ticketId) {
    const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, eventId, deletedAt: null } });
    if (!ticket) throw new AppError(ErrorCodes.TICKET_NOT_FOUND);
    return ticket;
}

// REGLA: una entrada cuyo dinero fue devuelto NUNCA vuelve a quedar
// utilizable por una acción del organizador (rehabilitar, reactivar,
// rehabilitar en lote, marcar usada). Sólo datos existentes, sin columnas
// nuevas:
//  - Ticket REFUNDED (reversión de Mercado Pago sobre un ticket ACTIVE).
//  - Venta con reversión de pago (refund/chargeback de MP): la reversión
//    sólo pasa ACTIVE -> REFUNDED, así que los tickets que en ese momento
//    estaban CANCELLED o USED quedan así. Se detecta por un ticket hermano
//    REFUNDED o por la fila DeveloperAlertReversalEvent de esa venta (que
//    mercadoPagoPaymentConfirmation.service.js escribe de forma durable).
//  - Devolución por arrepentimiento: el CANCELLED vigente vino de
//    returnWithdrawalRequestTicketsService (TicketAuditLog con
//    metadata.source de ese flujo, ver getWithdrawalReturnInfoForTickets).
// Una cancelación manual (cancelTicketService / cancelación en lote) sigue
// pudiendo rehabilitarse. `client` permite re-chequear dentro de la misma
// transacción que escribe.
export async function findReactivationBlockedTicketIds(tickets, client = prisma) {
    const blocked = new Set();
    if (!Array.isArray(tickets) || tickets.length === 0) return blocked;

    for (const ticket of tickets) {
        if (ticket.status === "REFUNDED") blocked.add(ticket.id);
    }

    const saleIds = [...new Set(tickets.map((t) => t.saleId).filter(Boolean))];
    if (saleIds.length > 0) {
        const [refundedSiblings, reversalEvents] = await Promise.all([
            client.ticket.findMany({ where: { saleId: { in: saleIds }, status: "REFUNDED" }, select: { saleId: true } }),
            client.developerAlertReversalEvent.findMany({ where: { saleId: { in: saleIds } }, select: { saleId: true } }),
        ]);
        const reversedSaleIds = new Set([...refundedSiblings, ...reversalEvents].map((row) => row.saleId));
        for (const ticket of tickets) {
            if (reversedSaleIds.has(ticket.saleId)) blocked.add(ticket.id);
        }
    }

    const cancelledIds = tickets.filter((t) => t.status === "CANCELLED").map((t) => t.id);
    if (cancelledIds.length > 0) {
        const returnInfo = await getWithdrawalReturnInfoForTickets(cancelledIds, client);
        for (const id of cancelledIds) {
            if (returnInfo.get(id)) blocked.add(id);
        }
    }

    return blocked;
}

async function assertTicketCanBecomeUsable(ticket, client = prisma) {
    const blocked = await findReactivationBlockedTicketIds([ticket], client);
    if (blocked.has(ticket.id)) throw new AppError(ErrorCodes.TICKET_REFUNDED_CANNOT_REACTIVATE);
}

// Transición genérica de status con su TicketAuditLog — cubre cancelar,
// rehabilitar y reactivar (los tres son "status actual válido -> status
// nuevo", sin tocar CheckIn). markTicketUsedManuallyService y
// softDeleteTicketService tienen forma propia porque además crean un
// CheckIn o tocan deletedAt en vez de status.
async function applyTransition(clerkId, eventId, ticketId, { allowedFrom, toStatus, action, reason }) {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    const ticket = await findOwnedTicket(eventId, ticketId);
    if (!allowedFrom.includes(ticket.status)) throw new AppError(ErrorCodes.TICKET_INVALID_TRANSITION);
    const becomesUsable = toStatus === "ACTIVE";
    if (becomesUsable) await assertTicketCanBecomeUsable(ticket);

    return prisma.$transaction(async (tx) => {
        const updated = await tx.ticket.update({ where: { id: ticket.id }, data: { status: toStatus } });
        // Re-chequeo bajo el lock de fila recién tomado: si una reversión de
        // Mercado Pago entró entre el chequeo de arriba y este update, se
        // hace rollback y el ticket queda como estaba.
        if (becomesUsable) await assertTicketCanBecomeUsable(ticket, tx);
        await tx.ticketAuditLog.create({
            data: {
                ticketId: ticket.id,
                action,
                fromStatus: ticket.status,
                toStatus,
                actorType: "ORGANIZER",
                actorId: owned.user.id,
                reason: reason || null,
            },
        });
        return updated;
    });
}

// ACTIVE -> CANCELLED. confirmScanService ya sabe rechazar un ticket
// CANCELLED (mensaje "La entrada fue cancelada") — no hace falta tocar esa
// lógica para que cancelar funcione de punta a punta.
export const cancelTicketService = (clerkId, eventId, ticketId, { reason } = {}) =>
    applyTransition(clerkId, eventId, ticketId, { allowedFrom: ["ACTIVE"], toStatus: "CANCELLED", action: "CANCEL", reason });

// CANCELLED -> ACTIVE. Deshace una cancelación — la entrada nunca llegó a
// usarse, así que no hay ningún CheckIn que reconciliar acá (a diferencia
// de reactivar una usada).
export const rehabilitateTicketService = (clerkId, eventId, ticketId, { reason } = {}) =>
    applyTransition(clerkId, eventId, ticketId, { allowedFrom: ["CANCELLED"], toStatus: "ACTIVE", action: "REHABILITATE", reason });

// USED -> ACTIVE. Permite que el ticket vuelva a escanearse. A propósito
// NO toca los CheckIn existentes — quedan como historial de que ya entró
// antes; el próximo escaneo válido crea un CheckIn nuevo (ver
// confirmScanService, ya no hay @unique que lo impida).
export const reactivateUsedTicketService = (clerkId, eventId, ticketId, { reason } = {}) =>
    applyTransition(clerkId, eventId, ticketId, { allowedFrom: ["USED"], toStatus: "ACTIVE", action: "REACTIVATE", reason });

// ACTIVE -> USED sin escaneo real: crea un CheckIn con source MANUAL
// (scannerId null: no hay un EventScanner real detrás de esta acción, la
// hizo el organizador desde su cuenta). Cuenta para "ingresados/capacidad"
// exactamente igual que un escaneo real, porque esos contadores sólo miran
// Ticket.status (ver functionCapacity.service.js) — no distinguen origen.
export const markTicketUsedManuallyService = async (clerkId, eventId, ticketId, { gate, reason } = {}) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    const ticket = await findOwnedTicket(eventId, ticketId);
    if (ticket.status !== "ACTIVE") throw new AppError(ErrorCodes.TICKET_INVALID_TRANSITION);
    // Un check-in manual equivale a admitir la entrada: tampoco sobre una
    // venta cuyo pago fue revertido.
    await assertTicketCanBecomeUsable(ticket);

    // Regla "evento finalizado = evento finalizado" — check-in manual del
    // organizador (equivalente a un escaneo real, ver comentario de arriba)
    // sobre una función ya finalizada queda bloqueado igual que el scanner.
    const eventFunction = await prisma.eventFunction.findUnique({ where: { id: ticket.functionId } });
    assertFunctionActive(eventFunction);

    return prisma.$transaction(async (tx) => {
        const updated = await tx.ticket.update({ where: { id: ticket.id }, data: { status: "USED" } });
        await assertTicketCanBecomeUsable(ticket, tx);
        await tx.checkIn.create({
            data: { ticketId: ticket.id, source: "MANUAL", gate: gate || null, scannerId: null, device: null },
        });
        await tx.ticketAuditLog.create({
            data: {
                ticketId: ticket.id,
                action: "MARK_USED_MANUAL",
                fromStatus: "ACTIVE",
                toStatus: "USED",
                actorType: "ORGANIZER",
                actorId: owned.user.id,
                reason: reason || null,
            },
        });
        return updated;
    });
};

// Soft delete — mismo criterio que el resto de la app (Ticket.deletedAt ya
// existía y varias lecturas ya lo respetan, ej. findConfirmedRecoverableSales
// y listTicketsOrganizerService). No cambia Ticket.status (son dimensiones
// independientes): toStatus queda null en el log, fromStatus registra en
// qué estado estaba al momento de borrarse.
export const softDeleteTicketService = async (clerkId, eventId, ticketId, { reason } = {}) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    const ticket = await findOwnedTicket(eventId, ticketId); // ya excluye deletedAt: null

    await prisma.$transaction(async (tx) => {
        await tx.ticket.update({ where: { id: ticket.id }, data: { deletedAt: new Date() } });
        await tx.ticketAuditLog.create({
            data: {
                ticketId: ticket.id,
                action: "SOFT_DELETE",
                fromStatus: ticket.status,
                toStatus: null,
                actorType: "ORGANIZER",
                actorId: owned.user.id,
                reason: reason || null,
            },
        });
    });
};

export function buildBulkTicketActionPlan({ action, tickets, actorId, reason }) {
    const auditRows = [];
    const updateIds = [];

    for (const ticket of tickets) {
        if (action === "cancel" && ticket.status === "ACTIVE") {
            updateIds.push(ticket.id);
            auditRows.push({
                ticketId: ticket.id,
                action: "CANCEL",
                fromStatus: ticket.status,
                toStatus: "CANCELLED",
                actorType: "ORGANIZER",
                actorId,
                reason: reason || null,
            });
            continue;
        }

        if (action === "rehabilitate" && (ticket.status === "CANCELLED" || ticket.status === "USED")) {
            updateIds.push(ticket.id);
            auditRows.push({
                ticketId: ticket.id,
                action: ticket.status === "USED" ? "REACTIVATE" : "REHABILITATE",
                fromStatus: ticket.status,
                toStatus: "ACTIVE",
                actorType: "ORGANIZER",
                actorId,
                reason: reason || null,
            });
            continue;
        }

        if (action === "delete") {
            updateIds.push(ticket.id);
            auditRows.push({
                ticketId: ticket.id,
                action: "SOFT_DELETE",
                fromStatus: ticket.status,
                toStatus: null,
                actorType: "ORGANIZER",
                actorId,
                reason: reason || null,
            });
        }
    }

    return { updateIds, auditRows };
}

export const bulkApplyTicketActionService = async (clerkId, eventId, { ticketIds, action, reason } = {}) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const ids = Array.isArray(ticketIds) ? ticketIds.filter(Boolean) : [];
    if (ids.length === 0) return [];

    const tickets = await prisma.ticket.findMany({
        where: { id: { in: ids }, eventId, deletedAt: null },
        select: { id: true, status: true, saleId: true },
    });

    // "Rehabilitar seleccionadas": los tickets bloqueados (reembolso,
    // contracargo, arrepentimiento) se omiten igual que los que no están en
    // un estado elegible — nunca se reactivan.
    let eligibleTickets = tickets;
    if (action === "rehabilitate") {
        const blocked = await findReactivationBlockedTicketIds(tickets);
        eligibleTickets = tickets.filter((t) => !blocked.has(t.id));
    }

    const plan = buildBulkTicketActionPlan({ action, tickets: eligibleTickets, actorId: owned.user.id, reason });
    if (plan.updateIds.length === 0) return [];

    let updateData;
    if (action === "cancel") {
        updateData = { status: "CANCELLED" };
    } else if (action === "rehabilitate") {
        updateData = { status: "ACTIVE" };
    } else if (action === "delete") {
        updateData = { deletedAt: new Date() };
    } else {
        return [];
    }

    await prisma.$transaction(async (tx) => {
        await tx.ticket.updateMany({ where: { id: { in: plan.updateIds } }, data: updateData });
        if (action === "rehabilitate") {
            const planned = eligibleTickets.filter((t) => plan.updateIds.includes(t.id));
            const blocked = await findReactivationBlockedTicketIds(planned, tx);
            if (blocked.size > 0) throw new AppError(ErrorCodes.TICKET_REFUNDED_CANNOT_REACTIVATE);
        }
        if (plan.auditRows.length > 0) {
            await tx.ticketAuditLog.createMany({ data: plan.auditRows });
        }
    });

    return plan.updateIds;
};
