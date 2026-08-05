import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getOwnedEvent } from "./eventScanner.service.js";

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

    return prisma.$transaction(async (tx) => {
        const updated = await tx.ticket.update({ where: { id: ticket.id }, data: { status: toStatus } });
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

// ACTIVE -> CANCELLED. validateScanService ya sabe rechazar un ticket
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
// validateScanService, ya no hay @unique que lo impida).
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

    return prisma.$transaction(async (tx) => {
        const updated = await tx.ticket.update({ where: { id: ticket.id }, data: { status: "USED" } });
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
// existía y varias lecturas ya lo respetan: listMyTicketsService,
// getTicketService). No cambia Ticket.status (son dimensiones
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

export const bulkApplyTicketActionService = async (clerkId, eventId, { ticketIds, action, reason } = {}) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const ids = Array.isArray(ticketIds) ? ticketIds.filter(Boolean) : [];
    if (ids.length === 0) return [];

    const tickets = await prisma.ticket.findMany({
        where: { id: { in: ids }, eventId, deletedAt: null },
        select: { id: true, status: true },
    });

    const ticketMap = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    const updatedTicketIds = [];

    await prisma.$transaction(async (tx) => {
        for (const ticketId of ids) {
            const ticket = ticketMap.get(ticketId);
            if (!ticket) continue;

            if (action === "cancel" && ticket.status === "ACTIVE") {
                const updated = await tx.ticket.update({ where: { id: ticketId }, data: { status: "CANCELLED" } });
                await tx.ticketAuditLog.create({
                    data: {
                        ticketId: updated.id,
                        action: "CANCEL",
                        fromStatus: ticket.status,
                        toStatus: "CANCELLED",
                        actorType: "ORGANIZER",
                        actorId: owned.user.id,
                        reason: reason || null,
                    },
                });
                updatedTicketIds.push(updated.id);
            } else if (action === "rehabilitate" && (ticket.status === "CANCELLED" || ticket.status === "USED")) {
                const nextStatus = ticket.status === "USED" ? "ACTIVE" : "ACTIVE";
                const updated = await tx.ticket.update({ where: { id: ticketId }, data: { status: nextStatus } });
                await tx.ticketAuditLog.create({
                    data: {
                        ticketId: updated.id,
                        action: ticket.status === "USED" ? "REACTIVATE" : "REHABILITATE",
                        fromStatus: ticket.status,
                        toStatus: nextStatus,
                        actorType: "ORGANIZER",
                        actorId: owned.user.id,
                        reason: reason || null,
                    },
                });
                updatedTicketIds.push(updated.id);
            } else if (action === "delete") {
                const updated = await tx.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } });
                await tx.ticketAuditLog.create({
                    data: {
                        ticketId: updated.id,
                        action: "SOFT_DELETE",
                        fromStatus: ticket.status,
                        toStatus: null,
                        actorType: "ORGANIZER",
                        actorId: owned.user.id,
                        reason: reason || null,
                    },
                });
                updatedTicketIds.push(updated.id);
            }
        }
    });

    return updatedTicketIds;
};
