import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { normalizeBuyerDocument } from "../utils/validateBuyerDocument.js";

// Developer → Entradas — platform-wide a propósito, sólo lectura. No
// reutiliza listTicketsOrganizerService/ticketAdmin.service.js (ambos
// resuelven "la organización del que llama"): éste es un service aparte,
// mismo criterio que developerEvents.service.js.

// ticket.service.js:91 define un array equivalente pero no lo exporta, y
// ese archivo está fuera de alcance para modificar — mismo motivo por el
// que developerEvents.service.js define su propio EVENT_STATUS_VALUES en
// vez de importar de event.service.js.
const TICKET_STATUS_VALUES = new Set(["ACTIVE", "USED", "CANCELLED", "REFUNDED"]);
const SALE_ORIGIN_VALUES = new Set(["SALE", "COURTESY"]);
const DELETED_FILTER_VALUES = new Set(["ACTIVE", "DELETED", "ALL"]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePage(rawPage) {
    const page = Number(rawPage);
    return Number.isInteger(page) && page >= 1 ? page : 1;
}

function parseLimit(rawLimit) {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
    return Math.min(limit, MAX_LIMIT);
}

function buildWhere({ search, organizationId, eventId, status, origin, deleted }) {
    const where = {};
    const and = [];

    if (organizationId) where.event = { organizationId };
    if (eventId) where.eventId = eventId;
    if (TICKET_STATUS_VALUES.has(status)) where.status = status;
    if (SALE_ORIGIN_VALUES.has(origin)) where.origin = origin;

    const deletedFilter = DELETED_FILTER_VALUES.has(deleted) ? deleted : "ACTIVE";
    if (deletedFilter === "DELETED") where.deletedAt = { not: null };
    else if (deletedFilter !== "ALL") where.deletedAt = null; // "ACTIVE" (default)

    const term = search?.trim();
    if (term) {
        const normalizedDocument = normalizeBuyerDocument(term);
        and.push({
            OR: [
                { ticketNumber: { contains: term, mode: "insensitive" } },
                { buyer: { firstName: { contains: term, mode: "insensitive" } } },
                { buyer: { lastName: { contains: term, mode: "insensitive" } } },
                { buyer: { email: { contains: term, mode: "insensitive" } } },
                ...(normalizedDocument ? [{ sale: { buyerDocument: { contains: normalizedDocument } } }] : []),
            ],
        });
    }

    if (and.length > 0) where.AND = and;

    return where;
}

// Precio histórico — Ticket no guarda precio propio (ver auditoría);
// SaleItem.unitPrice es la única fuente real, reconstruible sólo por
// (saleId, ticketTypeId). Una sola query acotada a los pares únicos de la
// página actual, nunca una por ticket. SaleItem no tiene @@unique en esa
// combinación: si hubiera más de una fila (caso no observado en el flujo
// normal), se toma siempre la de menor `id` (orderBy id asc, primer match
// gana en el Map) — mismo criterio de desempate determinístico que
// developerEvents.service.js#getNextFunctionsByEventId.
async function getUnitPriceByKey(pageTickets) {
    const uniquePairs = [
        ...new Map(
            pageTickets.map((t) => [`${t.saleId}:${t.ticketTypeId}`, { saleId: t.saleId, ticketTypeId: t.ticketTypeId }])
        ).values(),
    ];
    if (uniquePairs.length === 0) return new Map();

    const saleItems = await prisma.saleItem.findMany({
        where: { OR: uniquePairs.map((p) => ({ saleId: p.saleId, ticketTypeId: p.ticketTypeId })) },
        orderBy: { id: "asc" },
        select: { saleId: true, ticketTypeId: true, unitPrice: true },
    });

    const unitPriceByKey = new Map();
    for (const item of saleItems) {
        const key = `${item.saleId}:${item.ticketTypeId}`;
        if (!unitPriceByKey.has(key)) unitPriceByKey.set(key, Number(item.unitPrice));
    }
    return unitPriceByKey;
}

export const listDeveloperTicketsService = async (filters = {}) => {
    const page = parsePage(filters.page);
    const limit = parseLimit(filters.limit);
    const skip = (page - 1) * limit;
    const where = buildWhere(filters);

    const [total, tickets] = await Promise.all([
        prisma.ticket.count({ where }),
        prisma.ticket.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                ticketNumber: true,
                status: true,
                origin: true,
                deletedAt: true,
                createdAt: true,
                saleId: true, // uso interno (join de precio) — nunca sale en la respuesta
                ticketTypeId: true, // uso interno (join de precio) — ya expuesto vía ticketType.id
                event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
                function: { select: { id: true, date: true, venue: true } },
                ticketType: { select: { id: true, name: true } },
                buyer: { select: { firstName: true, lastName: true } },
            },
        }),
    ]);

    const unitPriceByKey = await getUnitPriceByKey(tickets);

    const items = tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        origin: ticket.origin,
        deletedAt: ticket.deletedAt,
        event: { id: ticket.event.id, title: ticket.event.title },
        organization: ticket.event.organization,
        function: ticket.function,
        ticketType: ticket.ticketType,
        buyer: { name: [ticket.buyer.firstName, ticket.buyer.lastName].filter(Boolean).join(" ").trim() },
        unitPrice: unitPriceByKey.get(`${ticket.saleId}:${ticket.ticketTypeId}`) ?? null,
        createdAt: ticket.createdAt,
    }));

    return {
        items,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    };
};

export const getDeveloperTicketService = async (ticketId) => {
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            id: true,
            ticketNumber: true,
            status: true,
            origin: true,
            deletedAt: true,
            createdAt: true,
            saleId: true,
            ticketTypeId: true,
            event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
            function: { select: { id: true, date: true, venue: true } },
            ticketType: { select: { id: true, name: true } },
            buyer: { select: { firstName: true, lastName: true, email: true } },
            sale: { select: { buyerDocument: true } },
        },
    });
    if (!ticket) throw new AppError(ErrorCodes.TICKET_NOT_FOUND);

    const [unitPriceByKey, checkIns, auditLogs] = await Promise.all([
        getUnitPriceByKey([ticket]),
        prisma.checkIn.findMany({
            where: { ticketId },
            orderBy: { scannedAt: "desc" },
            select: { id: true, scannedAt: true, source: true, gate: true, device: true, scannerId: true },
        }),
        prisma.ticketAuditLog.findMany({
            where: { ticketId },
            orderBy: { createdAt: "desc" },
            select: { id: true, action: true, fromStatus: true, toStatus: true, actorType: true, actorId: true, reason: true, createdAt: true },
        }),
    ]);

    // CheckIn.scannerId / TicketAuditLog.actorId (actorType ORGANIZER) no son
    // relaciones Prisma formales — se resuelven acá, en memoria, con un solo
    // findMany cada uno sobre los ids que realmente aparecen en ESTE ticket,
    // nunca una consulta por check-in/log. Mismo patrón que
    // listTicketsOrganizerService (ticket.service.js:164-188).
    const scannerIds = new Set(checkIns.filter((c) => c.scannerId).map((c) => c.scannerId));
    const organizerActorIds = new Set(
        auditLogs.filter((l) => l.actorType === "ORGANIZER" && l.actorId).map((l) => l.actorId)
    );
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

    return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        origin: ticket.origin,
        deletedAt: ticket.deletedAt,
        createdAt: ticket.createdAt,
        event: { id: ticket.event.id, title: ticket.event.title },
        organization: ticket.event.organization,
        function: ticket.function,
        ticketType: ticket.ticketType,
        buyer: {
            name: [ticket.buyer.firstName, ticket.buyer.lastName].filter(Boolean).join(" ").trim(),
            email: ticket.buyer.email,
            document: ticket.sale?.buyerDocument ?? null,
        },
        unitPrice: unitPriceByKey.get(`${ticket.saleId}:${ticket.ticketTypeId}`) ?? null,
        checkIns: checkIns.map((c) => ({
            id: c.id,
            scannedAt: c.scannedAt,
            source: c.source,
            gate: c.gate,
            device: c.device,
            scanner: c.scannerId ? { name: scannerNameById.get(c.scannerId) ?? null } : null,
        })),
        auditLogs: auditLogs.map((log) => ({
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
    };
};

// Opciones del <select> de Evento en cascada — sólo cuando el Developer ya
// eligió una organización (ver contrato: nunca cargar todos los eventos de
// la plataforma en un solo combo). Sin `take`: un límite silencioso podría
// hacer desaparecer eventos reales del selector.
export const getDeveloperEventOptionsService = async (organizationId) => {
    if (!organizationId) return [];

    return prisma.event.findMany({
        where: { organizationId },
        select: { id: true, title: true },
        orderBy: [{ title: "asc" }, { id: "asc" }],
    });
};
