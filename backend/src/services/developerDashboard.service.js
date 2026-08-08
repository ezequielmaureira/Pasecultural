import prisma from "../config/prisma.js";
import { SOLD_TICKET_STATUSES } from "./functionCapacity.service.js";
import { runArchiveSelfHeal } from "./eventArchive.service.js";

// Única fuente del Dashboard Developer (V1) — panel de control de TODA la
// plataforma, nunca acotado a una organización (a diferencia de todo lo de
// ORGANIZER, que siempre resuelve `getMyOrganizationService(clerkId)`).
// Ningún query de este archivo lleva `organizationId`/`clerkId` como
// filtro de scoping a propósito.

const UPCOMING_EVENTS_LIMIT = 5;
// Cada fuente de actividad trae como máximo esto — después se combinan,
// ordenan y se recorta a 8 en total (ver getRecentActivity).
const ACTIVITY_SOURCE_LIMIT = 8;
const RECENT_ACTIVITY_LIMIT = 8;

// Mismo criterio ya usado en todo el resto de la app (functionCapacity.service.js):
// `sold`/"vendido" = origin SALE + status en SOLD_TICKET_STATUSES, sin
// filtrar `deletedAt` (inconsistencia heredada, deliberadamente no
// corregida acá — ver informe).
async function getKpis() {
    const [usersTotal, organizersTotal, pendingOrganizations, publishedEvents, soldTickets, grossSales] =
        await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { role: "ORGANIZER" } }),
            prisma.organization.count({ where: { status: "PENDING" } }),
            prisma.event.count({ where: { status: "PUBLISHED", archivedAt: null } }),
            prisma.ticket.count({ where: { origin: "SALE", status: { in: SOLD_TICKET_STATUSES } } }),
            prisma.sale.aggregate({
                where: { origin: "SALE", status: "CONFIRMED", deletedAt: null },
                _sum: { total: true },
            }),
        ]);

    return {
        usersTotal,
        organizersTotal,
        pendingOrganizations,
        publishedEvents,
        soldTickets,
        // "Volumen bruto de ventas" — nunca "recaudación"/"ingresos" (no hay
        // comisión ni cobro real todavía). Decimal -> Number explícito.
        grossSalesVolume: Number(grossSales._sum.total ?? 0),
    };
}

// Un solo registro por evento, con su función futura más próxima. Dos
// pasos, sin N+1: (1) groupBy trae la fecha mínima por evento ya ordenada y
// limitada en Postgres; (2) un único findMany trae el detalle real de esas
// (eventId, fecha) exactas. Si dos funciones del mismo evento comparten
// exactamente la misma fecha mínima, el desempate es determinístico (id de
// función ascendente) para que el resultado siga siendo un solo elemento
// por evento, siempre el mismo ante los mismos datos.
async function getUpcomingEvents(now) {
    const grouped = await prisma.eventFunction.groupBy({
        by: ["eventId"],
        where: {
            date: { gte: now },
            status: { not: "CANCELLED" },
            event: { status: "PUBLISHED", archivedAt: null },
        },
        _min: { date: true },
        orderBy: { _min: { date: "asc" } },
        take: UPCOMING_EVENTS_LIMIT,
    });

    if (grouped.length === 0) return [];

    const details = await prisma.eventFunction.findMany({
        where: { OR: grouped.map((g) => ({ eventId: g.eventId, date: g._min.date })) },
        orderBy: { id: "asc" },
        select: {
            id: true,
            date: true,
            venue: true,
            event: { select: { id: true, title: true, organization: { select: { name: true } } } },
        },
    });

    const detailByEventId = new Map();
    for (const detail of details) {
        if (!detailByEventId.has(detail.event.id)) {
            detailByEventId.set(detail.event.id, detail);
        }
    }

    return grouped
        .map((g) => detailByEventId.get(g.eventId))
        .filter(Boolean)
        .map((detail) => ({
            eventId: detail.event.id,
            title: detail.event.title,
            organizationName: detail.event.organization.name,
            nextFunctionId: detail.id,
            nextFunctionDate: detail.date,
            venue: detail.venue ?? null,
        }));
}

// 5 fuentes en paralelo, cada una acotada con take/orderBy/select — nunca
// una tabla completa. Se combinan, ordenan por occurredAt desc y se
// recortan a RECENT_ACTIVITY_LIMIT en memoria (a lo sumo 5*8 = 40 filas
// livianas). Sin AuditLog, sin tabla nueva: sólo timestamps que ya existen.
async function getRecentActivity(now) {
    const [orgsCreated, orgsApproved, eventsCreated, eventsPublished, salesConfirmed] = await Promise.all([
        prisma.organization.findMany({
            orderBy: { createdAt: "desc" },
            take: ACTIVITY_SOURCE_LIMIT,
            select: { id: true, name: true, createdAt: true },
        }),
        prisma.organization.findMany({
            where: { approvedAt: { not: null } },
            orderBy: { approvedAt: "desc" },
            take: ACTIVITY_SOURCE_LIMIT,
            select: { id: true, name: true, approvedAt: true },
        }),
        prisma.event.findMany({
            orderBy: { createdAt: "desc" },
            take: ACTIVITY_SOURCE_LIMIT,
            select: { id: true, title: true, createdAt: true, organization: { select: { name: true } } },
        }),
        prisma.event.findMany({
            where: { publishedAt: { not: null } },
            orderBy: { publishedAt: "desc" },
            take: ACTIVITY_SOURCE_LIMIT,
            select: { id: true, title: true, publishedAt: true, organization: { select: { name: true } } },
        }),
        // Sólo lo mínimo para armar el texto — nunca comprador/email/DNI/
        // paymentRef/publicRecoveryToken (ver informe, sección Seguridad).
        prisma.sale.findMany({
            where: { status: "CONFIRMED", origin: "SALE", deletedAt: null },
            orderBy: { confirmedAt: "desc" },
            take: ACTIVITY_SOURCE_LIMIT,
            select: { id: true, confirmedAt: true, event: { select: { id: true, title: true } } },
        }),
    ]);

    const items = [
        ...orgsCreated.map((o) => ({
            type: "ORGANIZATION_CREATED",
            occurredAt: o.createdAt,
            title: "Nueva organización",
            description: `"${o.name}" se registró`,
            entityId: o.id,
        })),
        ...orgsApproved.map((o) => ({
            type: "ORGANIZATION_APPROVED",
            occurredAt: o.approvedAt,
            title: "Organización aprobada",
            description: `"${o.name}" fue aprobada`,
            entityId: o.id,
        })),
        ...eventsCreated.map((e) => ({
            type: "EVENT_CREATED",
            occurredAt: e.createdAt,
            title: "Nuevo evento",
            description: `"${e.title}" (${e.organization.name})`,
            entityId: e.id,
        })),
        ...eventsPublished.map((e) => ({
            type: "EVENT_PUBLISHED",
            occurredAt: e.publishedAt,
            title: "Evento publicado",
            description: `"${e.title}" (${e.organization.name})`,
            entityId: e.id,
        })),
        ...salesConfirmed.map((s) => ({
            type: "SALE_CONFIRMED",
            occurredAt: s.confirmedAt,
            title: "Venta confirmada",
            description: `Nueva venta en "${s.event.title}"`,
            entityId: s.event.id,
        })),
    ];

    return items
        .filter((item) => item.occurredAt && item.occurredAt <= now)
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .slice(0, RECENT_ACTIVITY_LIMIT);
}

export const getDeveloperDashboardService = async () => {
    const now = new Date();

    // Una sola vez, ANTES de leer eventos (KPI publishedEvents y próximos
    // eventos dependen de que archivedAt esté al día) — mismo contrato ya
    // existente (organizationId/eventId opcionales; sin ninguno de los dos
    // corre platform-wide), sin modificarlo.
    await runArchiveSelfHeal(prisma, {}, now);

    const [kpis, upcomingEvents, recentActivity] = await Promise.all([
        getKpis(),
        getUpcomingEvents(now),
        getRecentActivity(now),
    ]);

    return { kpis, upcomingEvents, recentActivity };
};
