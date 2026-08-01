import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { decryptSecret } from "../config/qrEncryption.js";

// Nunca incluye `qr` (secretEncrypted) ni datos de la Sale (paymentRef,
// confirmedBy, etc.) — sólo lo que un dueño de entrada necesita ver.
const TICKET_DETAIL_INCLUDE = {
    event: { select: { id: true, title: true, slug: true, coverImage: true } },
    function: { select: { id: true, date: true, venue: true } },
    ticketType: { select: { id: true, name: true } },
};

export const listMyTicketsService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) return [];

    return prisma.ticket.findMany({
        where: { ownerId: user.id, deletedAt: null },
        include: TICKET_DETAIL_INCLUDE,
        orderBy: { createdAt: "desc" },
    });
};

export const getTicketService = async (clerkId, ticketId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: TICKET_DETAIL_INCLUDE });
    if (!ticket || ticket.deletedAt) throw new AppError(ErrorCodes.TICKET_NOT_FOUND);
    if (ticket.ownerId !== user.id) throw new AppError(ErrorCodes.TICKET_FORBIDDEN);

    return ticket;
};

// Único payload necesario para que el frontend renderice el QR: el token
// (ticketId.secret) armado a partir del secreto descifrado en el momento.
// Nunca devuelve secretEncrypted, ni ningún dato de Sale.
export const getQrPayloadService = async (clerkId, ticketId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { qr: true } });
    if (!ticket || ticket.deletedAt) throw new AppError(ErrorCodes.TICKET_NOT_FOUND);
    if (ticket.ownerId !== user.id) throw new AppError(ErrorCodes.TICKET_FORBIDDEN);

    const secret = decryptSecret(ticket.qr.secretEncrypted);

    return {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        qrToken: `${ticket.id}.${secret}`,
    };
};

// Búsqueda de soporte por número legible (PC-2026-000123). Accesible para
// el propio dueño de la entrada o para el organizador del evento al que
// pertenece — cualquier otro usuario recibe TICKET_NOT_FOUND (no se
// distingue de "no existe").
export const getTicketByNumberService = async (clerkId, ticketNumber) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const ticket = await prisma.ticket.findUnique({
        where: { ticketNumber },
        include: {
            ...TICKET_DETAIL_INCLUDE,
            buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
            event: { include: { organization: { select: { ownerId: true } } } },
        },
    });
    if (!ticket || ticket.deletedAt) throw new AppError(ErrorCodes.TICKET_NOT_FOUND);

    const isOwner = ticket.ownerId === user.id;
    const isOrganizer = ticket.event.organization.ownerId === user.id;
    if (!isOwner && !isOrganizer) throw new AppError(ErrorCodes.TICKET_NOT_FOUND);

    return ticket;
};
