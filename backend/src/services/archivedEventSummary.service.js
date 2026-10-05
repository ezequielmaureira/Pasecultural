import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getMyOrganization } from "./event.service.js";
import { getEventFunctionStats } from "./functionCapacity.service.js";
import { listSalesOrganizerService } from "./sale.service.js";

// Historial de Eventos — "informe final" de UN evento ya archivado,
// exclusivamente de LECTURA. Deliberadamente NO usa getOwnedEvent
// (eventScanner.service.js): ese guard rechaza a propósito cualquier
// evento con archivedAt seteado (EVENT_ARCHIVED) para proteger las
// operaciones activas — acá es justo al revés, sólo sirve para eventos
// YA archivados. La resolución de ownership se hace acá mismo, una sola
// vez, sin tocar ni relajar ese guard en ningún lado (ver el informe de
// la ronda "Historial de Eventos completo").
//
// Reutiliza EXACTAMENTE los mismos cálculos que ya existen, nunca una
// fórmula nueva:
//   - getEventFunctionStats (functionCapacity.service.js) para
//     capacidad/vendidas/emitidas/ingresadas/canceladas POR FUNCIÓN — la
//     misma fuente que ya usa "Estado de Funciones" en vivo.
//   - listSalesOrganizerService (sale.service.js) para las ventas — ya
//     soporta `eventId` puntual de un evento archivado sin pedir
//     archivedAt:null (ver el comentario en ese mismo archivo).
// Los KPIs derivados (recaudación, ocupación, ticket promedio) se
// terminan de calcular en el FRONTEND con el mismo selector puro que ya
// usa el Dashboard en vivo (functionStatsSelectors.js#buildEventStatsKpis)
// — este service sólo entrega los datos crudos que ese selector necesita.

const SCANNER_HISTORY_SELECT = {
    id: true,
    name: true,
    gate: true,
    status: true,
    firstName: true,
    lastName: true,
    createdAt: true,
};

// Mismo criterio que listEventScannersService (eventScanner.service.js),
// pero sin pasar por getOwnedEvent — acá ya se resolvió/verificó ownership
// una sola vez en getArchivedEventSummaryService.
async function listArchivedEventScanners(eventId) {
    const scanners = await prisma.eventScanner.findMany({
        where: { eventId, deletedAt: null },
        select: SCANNER_HISTORY_SELECT,
        orderBy: { createdAt: "asc" },
    });

    const scannerIds = scanners.map((s) => s.id);
    const checkInStats = scannerIds.length
        ? await prisma.checkIn.groupBy({
              by: ["scannerId"],
              where: { scannerId: { in: scannerIds } },
              _count: { _all: true },
              _max: { scannedAt: true },
          })
        : [];
    const statsByScannerId = new Map(
        checkInStats.map((s) => [s.scannerId, { checkInsCount: s._count._all, lastScanAt: s._max.scannedAt }])
    );

    return scanners.map((scanner) => ({
        id: scanner.id,
        name: [scanner.firstName, scanner.lastName].filter(Boolean).join(" ").trim() || scanner.name,
        gate: scanner.gate,
        status: scanner.status,
        createdAt: scanner.createdAt,
        checkInsCount: statsByScannerId.get(scanner.id)?.checkInsCount ?? 0,
        lastScanAt: statsByScannerId.get(scanner.id)?.lastScanAt ?? null,
    }));
}

// Entradas del evento — select propio (no reutiliza
// listTicketsOrganizerService.ts para no acoplarse a una forma pensada
// para la pantalla operativa de Entradas): acá además hace falta
// ticketType/origin (sección "Entradas" del Historial pide tipo y
// SALE/COURTESY) y `checkIns`/`auditLogs` con la forma exacta que ya
// consume buildActivityFeed (dashboardMetrics.js) en el frontend, para
// reusarlo tal cual en la sección "Actividad" sin inventar un segundo
// armador de timeline.
async function listArchivedEventTickets(eventId) {
    const tickets = await prisma.ticket.findMany({
        where: { eventId },
        select: {
            id: true,
            ticketNumber: true,
            status: true,
            origin: true,
            deletedAt: true,
            createdAt: true,
            function: { select: { id: true, date: true, venue: true } },
            ticketType: { select: { id: true, name: true } },
            buyer: { select: { firstName: true, lastName: true, email: true } },
            sale: { select: { buyerDocument: true } },
            checkIns: {
                orderBy: { scannedAt: "desc" },
                select: { id: true, scannedAt: true, gate: true, source: true, scannerId: true },
            },
            auditLogs: {
                orderBy: { createdAt: "desc" },
                select: { id: true, action: true, fromStatus: true, toStatus: true, createdAt: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    // Mismo patrón que listTicketsOrganizerService: CheckIn.scannerId no es
    // una relación Prisma formal, se resuelve a nombre en memoria con un
    // solo findMany sobre los ids que realmente aparecieron.
    const scannerIds = new Set();
    for (const ticket of tickets) {
        for (const checkIn of ticket.checkIns) if (checkIn.scannerId) scannerIds.add(checkIn.scannerId);
    }
    const scanners = scannerIds.size
        ? await prisma.eventScanner.findMany({
              where: { id: { in: [...scannerIds] } },
              select: { id: true, name: true, firstName: true, lastName: true },
          })
        : [];
    const scannerNameById = new Map(
        scanners.map((s) => [s.id, [s.firstName, s.lastName].filter(Boolean).join(" ").trim() || s.name])
    );

    return tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        origin: ticket.origin,
        deletedAt: ticket.deletedAt,
        createdAt: ticket.createdAt,
        functionDate: ticket.function.date,
        venue: ticket.function.venue,
        ticketTypeName: ticket.ticketType.name,
        buyerName: [ticket.buyer?.firstName, ticket.buyer?.lastName].filter(Boolean).join(" ").trim() || null,
        buyerEmail: ticket.buyer?.email ?? null,
        buyerDocument: ticket.sale?.buyerDocument ?? null,
        checkIns: ticket.checkIns.map((checkIn) => ({
            id: checkIn.id,
            scannedAt: checkIn.scannedAt,
            gate: checkIn.gate,
            source: checkIn.source,
            scannerName: checkIn.scannerId ? scannerNameById.get(checkIn.scannerId) ?? null : null,
        })),
        auditLogs: ticket.auditLogs,
    }));
}

// Único punto de entrada — resuelve ownership, EXIGE archivedAt != null
// (nunca un atajo para leer un evento vigente: ver EVENT_NOT_ARCHIVED_YET),
// y arma el payload completo que consume OrganizerEventHistoryDetail.jsx.
export async function getArchivedEventSummaryService(clerkId, eventId) {
    const context = await getMyOrganization(clerkId);
    if (!context) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: {
            id: true,
            title: true,
            slug: true,
            category: true,
            customCategory: true,
            coverImage: true,
            venue: true,
            venueName: true,
            formattedAddress: true,
            city: true,
            province: true,
            status: true,
            archivedAt: true,
            publishedAt: true,
            cancelledAt: true,
            createdAt: true,
            organizationId: true,
            functions: {
                orderBy: { date: "asc" },
                select: { id: true, date: true, venue: true, status: true, doorsOpenAt: true, endAt: true },
            },
        },
    });

    if (!event || event.organizationId !== context.organization.id) {
        throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    }
    if (!event.archivedAt) {
        throw new AppError(ErrorCodes.EVENT_NOT_ARCHIVED_YET);
    }

    const [functionStats, sales, tickets, scanners] = await Promise.all([
        getEventFunctionStats(prisma, eventId),
        listSalesOrganizerService(clerkId, { eventId }),
        listArchivedEventTickets(eventId),
        listArchivedEventScanners(eventId),
    ]);

    const { organizationId, functions, ...eventFields } = event;

    return {
        event: eventFields,
        functions,
        functionStats,
        sales,
        tickets,
        scanners,
    };
}
