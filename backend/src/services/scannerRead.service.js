import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { assertScannerAuthorized } from "../utils/assertScannerAuthorized.js";
import { effectiveCapacity, getFunctionStats } from "./functionCapacity.service.js";

const MAX_SCAN_ATTEMPTS_LIMIT = 50;
const DEFAULT_SCAN_ATTEMPTS_LIMIT = 20;

// Eventos donde el usuario autenticado tiene un EventScanner activo, con
// capacidad/ingresados/restantes por función — todo en un número fijo de
// queries (3), sin importar cuántos eventos/funciones/tickets existan:
//   1) EventScanner del usuario (sólo eventIds)
//   2) Event + funciones + asignaciones de tipos de entrada (include anidado
//      de Prisma: JOIN/batch, no un query por evento ni por función)
//   3) un único groupBy agregado de tickets USADOS de TODAS las funciones a
//      la vez, en vez de un count() por función.
export const listScannerEventsService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) return [];

    const assignments = await prisma.eventScanner.findMany({
        where: { userId: user.id, active: true, deletedAt: null },
        select: { eventId: true },
    });
    const eventIds = assignments.map((a) => a.eventId);
    if (eventIds.length === 0) return [];

    const events = await prisma.event.findMany({
        where: { id: { in: eventIds } },
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

    const allFunctionIds = events.flatMap((event) => event.functions.map((fn) => fn.id));
    const checkedInGroups = allFunctionIds.length
        ? await prisma.ticket.groupBy({
              by: ["functionId"],
              where: { functionId: { in: allFunctionIds }, status: "USED" },
              _count: { _all: true },
          })
        : [];
    const checkedInByFunction = new Map(checkedInGroups.map((g) => [g.functionId, g._count._all]));

    return events
        .map((event) => ({
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
        }))
        // Un evento sin ninguna función vigente no es una opción real para
        // el scanner — no tiene sentido listarlo vacío.
        .filter((event) => event.functions.length > 0);
};

export const getFunctionStatsService = async (clerkId, eventId, functionId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    await assertScannerAuthorized(prisma, eventId, user.id);

    const eventFunction = await prisma.eventFunction.findUnique({ where: { id: functionId } });
    if (!eventFunction || eventFunction.eventId !== eventId) {
        throw new AppError(ErrorCodes.FUNCTION_NOT_FOUND);
    }

    return getFunctionStats(prisma, functionId);
};

// Historial reciente de intentos de escaneo. Nunca devuelve ip/userAgent/
// scannedBy (quedan sólo en la base para auditoría) ni ningún dato de la
// Sale — sólo lo necesario para reconocer un intento en pantalla.
export const listScanAttemptsService = async (clerkId, eventId, functionId, limit) => {
    if (!eventId) throw new AppError(ErrorCodes.SCAN_ATTEMPTS_EVENT_REQUIRED);

    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    await assertScannerAuthorized(prisma, eventId, user.id);

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
