import prisma from "../config/prisma.js";
import { SOLD_TICKET_STATUSES } from "./functionCapacity.service.js";

// Pantalla de supervisión Developer → Eventos — platform-wide a propósito,
// nunca acotado por organización. No reutiliza ni toca ningún service de
// event.service.js (todos resuelven `getMyOrganization(clerkId)`, sólo la
// organización del que llama): éste es un service completamente aparte.

const EVENT_STATUS_VALUES = new Set(["DRAFT", "SCHEDULED", "PUBLISHED", "CANCELLED", "FINISHED"]);
const EVENT_VISIBILITY_VALUES = new Set(["PUBLIC", "PRIVATE"]);
const ARCHIVED_FILTER_VALUES = new Set(["ACTIVE", "ARCHIVED", "ALL"]);

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

function buildWhere({ search, organizationId, status, visibility, archived }) {
    const where = {};
    const and = [];

    if (search?.trim()) {
        const term = search.trim();
        and.push({
            OR: [
                { title: { contains: term, mode: "insensitive" } },
                { organization: { name: { contains: term, mode: "insensitive" } } },
            ],
        });
    }

    if (organizationId) where.organizationId = organizationId;
    if (EVENT_STATUS_VALUES.has(status)) where.status = status;
    if (EVENT_VISIBILITY_VALUES.has(visibility)) where.visibility = visibility;

    const archivedFilter = ARCHIVED_FILTER_VALUES.has(archived) ? archived : "ACTIVE";
    if (archivedFilter === "ARCHIVED") where.archivedAt = { not: null };
    else if (archivedFilter !== "ALL") where.archivedAt = null; // "ACTIVE" (default)

    if (and.length > 0) where.AND = and;

    return where;
}

// Un solo registro por evento — la EventFunction futura más próxima, o
// `null` si no tiene ninguna. A diferencia del KPI `publishedEvents` del
// Dashboard, ACÁ la ausencia de función vigente NUNCA excluye al evento:
// esta pantalla existe justamente para poder ver esos casos (evento
// publicado sin nada vendible hoy). Dos queries, acotadas a los eventos de
// la página actual — nunca una por evento.
async function getNextFunctionsByEventId(pageEventIds, now) {
    if (pageEventIds.length === 0) return new Map();

    const grouped = await prisma.eventFunction.groupBy({
        by: ["eventId"],
        where: { eventId: { in: pageEventIds }, date: { gte: now }, status: { not: "CANCELLED" } },
        _min: { date: true },
    });

    if (grouped.length === 0) return new Map();

    const details = await prisma.eventFunction.findMany({
        where: { OR: grouped.map((g) => ({ eventId: g.eventId, date: g._min.date })) },
        orderBy: { id: "asc" },
        select: { id: true, eventId: true, date: true, venue: true },
    });

    // Desempate determinístico si dos funciones del mismo evento comparten
    // exactamente la fecha mínima: la de menor `id` (ya ordenado arriba),
    // siempre la misma ante los mismos datos.
    const nextFunctionByEventId = new Map();
    for (const detail of details) {
        if (!nextFunctionByEventId.has(detail.eventId)) {
            nextFunctionByEventId.set(detail.eventId, { id: detail.id, date: detail.date, venue: detail.venue });
        }
    }
    return nextFunctionByEventId;
}

// "Vendidas" — misma semántica exacta que el resto de la plataforma
// (SOLD_TICKET_STATUSES importada, no redefinida; origin=SALE; sin filtrar
// deletedAt, misma deuda heredada que ya existe en todos lados). Una sola
// query agrupada para toda la página.
async function getSoldTicketsByEventId(pageEventIds) {
    if (pageEventIds.length === 0) return new Map();

    const soldGroups = await prisma.ticket.groupBy({
        by: ["eventId"],
        where: { eventId: { in: pageEventIds }, origin: "SALE", status: { in: SOLD_TICKET_STATUSES } },
        _count: { _all: true },
    });

    return new Map(soldGroups.map((g) => [g.eventId, g._count._all]));
}

export const listDeveloperEventsService = async (filters = {}) => {
    const now = new Date();
    const page = parsePage(filters.page);
    const limit = parseLimit(filters.limit);
    const skip = (page - 1) * limit;
    const where = buildWhere(filters);

    const [total, events] = await Promise.all([
        prisma.event.count({ where }),
        prisma.event.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                title: true,
                status: true,
                visibility: true,
                createdAt: true,
                archivedAt: true,
                organization: { select: { id: true, name: true } },
            },
        }),
    ]);

    const pageEventIds = events.map((e) => e.id);
    const [nextFunctionByEventId, soldTicketsByEventId] = await Promise.all([
        getNextFunctionsByEventId(pageEventIds, now),
        getSoldTicketsByEventId(pageEventIds),
    ]);

    const items = events.map((event) => ({
        id: event.id,
        title: event.title,
        organization: event.organization,
        status: event.status,
        visibility: event.visibility,
        createdAt: event.createdAt,
        archivedAt: event.archivedAt,
        nextFunction: nextFunctionByEventId.get(event.id) ?? null,
        soldTickets: soldTicketsByEventId.get(event.id) ?? 0,
    }));

    return {
        items,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    };
};

// Sólo para llenar el <select> de organizaciones del frontend — nunca el
// owner, nunca más campos que estos dos.
export const getDeveloperOrganizationOptionsService = async () => {
    return prisma.organization.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
};
