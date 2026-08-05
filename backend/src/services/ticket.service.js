import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { decryptSecret } from "../config/qrEncryption.js";
import { normalizeBuyerDocument } from "../utils/validateBuyerDocument.js";

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

// Panel de organizador ("Entradas") — todos los tickets vendidos a lo largo
// de TODOS los eventos del organizador, con búsqueda y filtro de estado.
// Mismo criterio de resolución de organización que listSalesOrganizerService
// (sale.service.js): un organizador = una Organization (findFirst por
// ownerId), y el alcance es `event.organizationId`, nunca un eventId suelto
// que venga del cliente.
const TICKET_STATUS_VALUES = ["ACTIVE", "USED", "CANCELLED", "REFUNDED"];

export const listTicketsOrganizerService = async (clerkId, { search, status, eventId, functionId } = {}) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) return [];

    const organization = await prisma.organization.findFirst({ where: { ownerId: user.id } });
    if (!organization) return [];

    const where = { event: { organizationId: organization.id } };

    if (eventId) where.eventId = eventId;
    if (functionId) where.functionId = functionId;

    // "DELETED" es el único filtro que efectivamente busca tickets con
    // deletedAt seteado — todos los demás (incluido "ALL"/sin filtro)
    // excluyen soft-deleted, mismo criterio que el resto de la app.
    if (status === "DELETED") {
        where.deletedAt = { not: null };
    } else {
        where.deletedAt = null;
        if (TICKET_STATUS_VALUES.includes(status)) where.status = status;
    }

    const term = search?.trim();
    if (term) {
        const normalizedDocument = normalizeBuyerDocument(term);
        where.OR = [
            { ticketNumber: { contains: term, mode: "insensitive" } },
            { buyer: { firstName: { contains: term, mode: "insensitive" } } },
            { buyer: { lastName: { contains: term, mode: "insensitive" } } },
            { buyer: { email: { contains: term, mode: "insensitive" } } },
            ...(normalizedDocument ? [{ sale: { buyerDocument: { contains: normalizedDocument } } }] : []),
        ];
    }

    const tickets = await prisma.ticket.findMany({
        where,
        select: {
            id: true,
            ticketNumber: true,
            status: true,
            createdAt: true,
            deletedAt: true,
            event: { select: { id: true, title: true } },
            function: { select: { date: true, venue: true } },
            buyer: { select: { firstName: true, lastName: true, email: true } },
            sale: { select: { buyerDocument: true } },
            checkIns: {
                orderBy: { scannedAt: "desc" },
                select: { id: true, scannedAt: true, gate: true, source: true, scannerId: true },
            },
            auditLogs: {
                orderBy: { createdAt: "desc" },
                select: { id: true, action: true, fromStatus: true, toStatus: true, actorType: true, actorId: true, reason: true, createdAt: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    // CheckIn.scannerId / TicketAuditLog.actorId (actorType ORGANIZER) no
    // son relaciones Prisma formales (String suelto — ver auditoría del
    // modelo), así que sus nombres se resuelven acá, en memoria, con un solo
    // findMany cada uno sobre los ids que realmente aparecieron — nunca una
    // consulta por fila.
    const scannerIds = new Set();
    const organizerActorIds = new Set();
    for (const ticket of tickets) {
        for (const checkIn of ticket.checkIns) if (checkIn.scannerId) scannerIds.add(checkIn.scannerId);
        for (const log of ticket.auditLogs) if (log.actorType === "ORGANIZER" && log.actorId) organizerActorIds.add(log.actorId);
    }
    const [scanners, organizerActors] = await Promise.all([
        scannerIds.size
            ? prisma.eventScanner.findMany({ where: { id: { in: [...scannerIds] } }, select: { id: true, name: true, firstName: true, lastName: true } })
            : [],
        organizerActorIds.size
            ? prisma.user.findMany({ where: { id: { in: [...organizerActorIds] } }, select: { id: true, firstName: true, lastName: true } })
            : [],
    ]);
    const scannerNameById = new Map(
        scanners.map((s) => [s.id, [s.firstName, s.lastName].filter(Boolean).join(" ").trim() || s.name])
    );
    const organizerNameById = new Map(
        organizerActors.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "Organizador"])
    );

    return tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        deletedAt: ticket.deletedAt,
        createdAt: ticket.createdAt,
        eventId: ticket.event.id,
        eventTitle: ticket.event.title,
        functionDate: ticket.function.date,
        venue: ticket.function.venue,
        buyerName: [ticket.buyer.firstName, ticket.buyer.lastName].filter(Boolean).join(" ").trim(),
        buyerEmail: ticket.buyer.email,
        buyerDocument: ticket.sale?.buyerDocument ?? null,
        checkIns: ticket.checkIns.map((checkIn) => ({
            id: checkIn.id,
            scannedAt: checkIn.scannedAt,
            gate: checkIn.gate,
            source: checkIn.source,
            scannerName: checkIn.scannerId ? scannerNameById.get(checkIn.scannerId) ?? null : null,
        })),
        auditLogs: ticket.auditLogs.map((log) => ({
            id: log.id,
            action: log.action,
            fromStatus: log.fromStatus,
            toStatus: log.toStatus,
            actorType: log.actorType,
            actorName:
                log.actorType === "ORGANIZER"
                    ? organizerNameById.get(log.actorId) ?? null
                    : log.actorType === "SCANNER"
                      ? scannerNameById.get(log.actorId) ?? null
                      : "Sistema",
            reason: log.reason,
            createdAt: log.createdAt,
        })),
        functionId: ticket.function.id,
    }));
};
