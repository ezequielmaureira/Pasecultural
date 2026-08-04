import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { effectiveCapacity, getFunctionStats } from "./functionCapacity.service.js";

const MAX_SCAN_ATTEMPTS_LIMIT = 50;
const DEFAULT_SCAN_ATTEMPTS_LIMIT = 20;

// `scannerContext` es req.scanner, ya resuelto y verificado ACTIVE por
// requireScannerSession — nunca se vuelve a resolver identidad acá. Un
// scannerSessionToken está ligado a UN solo EventScanner = UN solo evento
// (a diferencia del viejo modelo por Clerk, donde una cuenta podía tener
// varias asignaciones), así que "mis eventos" es siempre, a lo sumo, un
// array de un elemento — se mantiene la forma de array para no tocar nada
// del frontend (selección de evento/función), que ya sabe manejar 1 o más.
export const listScannerEventsService = async (scannerContext) => {
    // "Último acceso" (columna que pide la gestión de scanners): se
    // actualiza acá, no en validateScanService — este endpoint ya se llama
    // cada vez que el scanner abre la app (antes de escanear nada). No se
    // espera el resultado (no debe demorar la respuesta al scanner por
    // esto).
    prisma.eventScanner.update({ where: { id: scannerContext.id }, data: { lastAccessAt: new Date() } }).catch(() => {});

    const event = await prisma.event.findUnique({
        where: { id: scannerContext.eventId },
        select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            functions: {
                where: { status: "SCHEDULED" },
                orderBy: { date: "asc" },
                select: {
                    id: true,
                    date: true,
                    ticketAssignments: {
                        where: { enabled: true },
                        select: {
                            ticketTypeId: true,
                            quantityOverride: true,
                            ticketType: { select: { quantity: true } },
                        },
                    },
                },
            },
        },
    });
    if (!event || event.functions.length === 0) return [];

    const functionIds = event.functions.map((fn) => fn.id);
    const checkedInGroups = await prisma.ticket.groupBy({
        by: ["functionId"],
        where: { functionId: { in: functionIds }, status: "USED" },
        _count: { _all: true },
    });
    const checkedInByFunction = new Map(checkedInGroups.map((g) => [g.functionId, g._count._all]));

    return [
        {
            id: event.id,
            title: event.title,
            slug: event.slug,
            coverImage: event.coverImage,
            functions: event.functions.map((fn) => {
                const capacity = fn.ticketAssignments.reduce((sum, a) => sum + effectiveCapacity(a), 0);
                const checkedIn = checkedInByFunction.get(fn.id) ?? 0;
                return {
                    id: fn.id,
                    date: fn.date,
                    capacity,
                    checkedIn,
                    remaining: Math.max(capacity - checkedIn, 0),
                };
            }),
        },
    ];
};

export const getFunctionStatsService = async (scannerContext, eventId, functionId) => {
    if (eventId !== scannerContext.eventId) throw new AppError(ErrorCodes.SCANNER_NOT_AUTHORIZED);

    const eventFunction = await prisma.eventFunction.findUnique({ where: { id: functionId } });
    if (!eventFunction || eventFunction.eventId !== eventId) {
        throw new AppError(ErrorCodes.FUNCTION_NOT_FOUND);
    }

    return getFunctionStats(prisma, functionId);
};

// Historial reciente de intentos de escaneo. Nunca devuelve ip/userAgent/
// scannedBy (quedan sólo en la base para auditoría) ni ningún dato de la
// Sale — sólo lo necesario para reconocer un intento en pantalla.
export const listScanAttemptsService = async (scannerContext, eventId, functionId, limit) => {
    if (!eventId) throw new AppError(ErrorCodes.SCAN_ATTEMPTS_EVENT_REQUIRED);
    if (eventId !== scannerContext.eventId) throw new AppError(ErrorCodes.SCANNER_NOT_AUTHORIZED);

    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), MAX_SCAN_ATTEMPTS_LIMIT)
        : DEFAULT_SCAN_ATTEMPTS_LIMIT;

    // Los intentos sin ticket resuelto (NOT_FOUND de un token que ni
    // siquiera existía) no tienen función asociada — se incluyen siempre
    // que sean de este evento, no sólo los que matchean la función, porque
    // igual pasaron durante la sesión de escaneo activa del operador.
    const where = functionId
        ? { eventId, OR: [{ ticketId: null }, { ticket: { functionId } }] }
        : { eventId };

    const attempts = await prisma.scanAttempt.findMany({
        where,
        orderBy: { scannedAt: "desc" },
        take: safeLimit,
        select: {
            id: true,
            result: true,
            scannedAt: true,
            ticket: {
                select: {
                    ticketNumber: true,
                    buyer: { select: { firstName: true, lastName: true } },
                    ticketType: { select: { name: true } },
                },
            },
        },
    });

    return attempts.map((attempt) => ({
        id: attempt.id,
        result: attempt.result,
        scannedAt: attempt.scannedAt,
        ticketNumber: attempt.ticket?.ticketNumber ?? null,
        buyerName: attempt.ticket
            ? [attempt.ticket.buyer.firstName, attempt.ticket.buyer.lastName].filter(Boolean).join(" ").trim() || null
            : null,
        ticketType: attempt.ticket?.ticketType.name ?? null,
    }));
};
