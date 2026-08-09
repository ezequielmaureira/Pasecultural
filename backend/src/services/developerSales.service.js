import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { normalizeBuyerDocument } from "../utils/validateBuyerDocument.js";

// Developer → Ventas — platform-wide a propósito, sólo lectura. No
// reutiliza listSalesOrganizerService (organizer-scoped vía
// getOrganizationByOwner): éste es un service completamente aparte, mismo
// criterio que developerEvents/developerTickets/developerScanners.service.js.
// "Venta" = exclusivamente origin:"SALE" (las COURTESY tienen su propio
// módulo, courtesy.service.js) + deletedAt:null siempre (sin toggle
// ACTIVE/DELETED/ALL en V1 — decisión cerrada en el contrato).

// SaleStatus no tiene un array exportado reutilizable sin tocar
// sale.service.js (fuera de alcance) — mismo motivo por el que los tres
// contratos anteriores definen su propio Set local.
const SALE_STATUS_VALUES = new Set(["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"]);

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

function buildWhere({ search, organizationId, eventId, status }) {
    const where = { origin: "SALE", deletedAt: null };
    const and = [];

    if (organizationId) where.event = { organizationId };
    if (eventId) where.eventId = eventId;
    if (SALE_STATUS_VALUES.has(status)) where.status = status;

    const term = search?.trim();
    if (term) {
        const normalizedDocument = normalizeBuyerDocument(term);
        and.push({
            OR: [
                { buyer: { firstName: { contains: term, mode: "insensitive" } } },
                { buyer: { lastName: { contains: term, mode: "insensitive" } } },
                { buyer: { email: { contains: term, mode: "insensitive" } } },
                ...(normalizedDocument ? [{ buyerDocument: { contains: normalizedDocument } }] : []),
            ],
        });
    }

    if (and.length > 0) where.AND = and;

    return where;
}

export const listDeveloperSalesService = async (filters = {}) => {
    const page = parsePage(filters.page);
    const limit = parseLimit(filters.limit);
    const skip = (page - 1) * limit;
    const where = buildWhere(filters);

    // count + findMany en paralelo — _count.tickets viaja anidado en el
    // mismo findMany (Sale.tickets es relación Prisma formal, no un id
    // suelto): cero batch adicional, a diferencia de Entradas/Scanners.
    const [total, sales] = await Promise.all([
        prisma.sale.count({ where }),
        prisma.sale.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                status: true,
                total: true,
                createdAt: true,
                event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
                buyer: { select: { firstName: true, lastName: true } },
                _count: { select: { tickets: true } },
            },
        }),
    ]);

    const items = sales.map((sale) => ({
        id: sale.id,
        status: sale.status,
        event: { id: sale.event.id, title: sale.event.title },
        organization: sale.event.organization,
        buyer: { name: [sale.buyer.firstName, sale.buyer.lastName].filter(Boolean).join(" ").trim() || null },
        ticketsCount: sale._count.tickets,
        total: Number(sale.total),
        createdAt: sale.createdAt,
    }));

    return {
        items,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    };
};

export const getDeveloperSaleService = async (saleId) => {
    // origin:"SALE" también acá: una COURTESY nunca debe poder verse por
    // detalle adivinando/copiando un id, aunque no aparezca en el listado
    // — mismo criterio "no existe" que el resto del catálogo de errores.
    const sale = await prisma.sale.findFirst({
        where: { id: saleId, origin: "SALE", deletedAt: null },
        select: {
            id: true,
            status: true,
            total: true,
            createdAt: true,
            confirmedAt: true,
            buyerDocument: true,
            event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
            function: { select: { id: true, date: true, venue: true } },
            buyer: { select: { firstName: true, lastName: true, email: true } },
            items: {
                select: {
                    id: true,
                    quantity: true,
                    unitPrice: true,
                    subtotal: true,
                    ticketType: { select: { id: true, name: true } },
                },
            },
            tickets: {
                where: { deletedAt: null },
                orderBy: { sequence: "asc" },
                select: { id: true, ticketNumber: true, status: true },
            },
        },
    });
    if (!sale) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    return {
        id: sale.id,
        status: sale.status,
        total: Number(sale.total),
        createdAt: sale.createdAt,
        confirmedAt: sale.confirmedAt,
        event: { id: sale.event.id, title: sale.event.title },
        organization: sale.event.organization,
        function: sale.function,
        buyer: {
            name: [sale.buyer.firstName, sale.buyer.lastName].filter(Boolean).join(" ").trim() || null,
            email: sale.buyer.email,
            document: sale.buyerDocument,
        },
        items: sale.items.map((item) => ({
            id: item.id,
            ticketType: item.ticketType,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            subtotal: Number(item.subtotal),
        })),
        tickets: sale.tickets.map((ticket) => ({
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            status: ticket.status,
        })),
    };
};
