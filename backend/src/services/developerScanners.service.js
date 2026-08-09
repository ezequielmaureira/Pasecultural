import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";

// Developer → Scanners — platform-wide a propósito, sólo lectura. No
// reutiliza eventScanner.service.js (organizer-scoped vía getOwnedEvent):
// éste es un service completamente aparte, mismo criterio que
// developerEvents.service.js/developerTickets.service.js.

// EventScannerStatus no tiene un array exportado reutilizable sin tocar
// eventScanner.service.js (fuera de alcance) — mismo motivo por el que los
// dos contratos anteriores definen su propio Set local.
const EVENT_SCANNER_STATUS_VALUES = new Set(["INVITED", "ACTIVE", "DISABLED", "REVOKED"]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const RECENT_CHECKINS_LIMIT = 20;

function parsePage(rawPage) {
    const page = Number(rawPage);
    return Number.isInteger(page) && page >= 1 ? page : 1;
}

function parseLimit(rawLimit) {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
    return Math.min(limit, MAX_LIMIT);
}

// deletedAt:null fijo, sin parámetro deleted=ACTIVE|DELETED|ALL — decisión
// cerrada en el contrato: un EventScanner soft-deleted es administración
// del organizador, sin valor de supervisión de plataforma en V1.
function buildWhere({ search, organizationId, eventId, status }) {
    const where = { deletedAt: null };
    const and = [];

    if (organizationId) where.event = { organizationId };
    if (eventId) where.eventId = eventId;
    if (EVENT_SCANNER_STATUS_VALUES.has(status)) where.status = status;

    const term = search?.trim();
    if (term) {
        and.push({
            OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
                { email: { contains: term, mode: "insensitive" } },
                { name: { contains: term, mode: "insensitive" } },
            ],
        });
    }

    if (and.length > 0) where.AND = and;

    return where;
}

function buildPersonName(scanner) {
    return [scanner.firstName, scanner.lastName].filter(Boolean).join(" ").trim() || null;
}

// "Escaneos" y "último escaneo" reales — EventScanner.lastScanAt está en el
// schema pero ningún caller lo escribe (columna dormant, confirmado en la
// auditoría); la única fuente correcta es CheckIn.scannerId, agrupado en
// una sola query acotada a los ids de la página actual. Nunca una query por
// scanner.
async function getCheckInStatsByScannerId(pageScannerIds) {
    if (pageScannerIds.length === 0) return new Map();

    const groups = await prisma.checkIn.groupBy({
        by: ["scannerId"],
        where: { scannerId: { in: pageScannerIds } },
        _count: { _all: true },
        _max: { scannedAt: true },
    });

    return new Map(groups.map((g) => [g.scannerId, { checkInsCount: g._count._all, lastScanAt: g._max.scannedAt }]));
}

export const listDeveloperScannersService = async (filters = {}) => {
    const page = parsePage(filters.page);
    const limit = parseLimit(filters.limit);
    const skip = (page - 1) * limit;
    const where = buildWhere(filters);

    const [total, scanners] = await Promise.all([
        prisma.eventScanner.count({ where }),
        prisma.eventScanner.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                firstName: true,
                lastName: true,
                gate: true,
                status: true,
                createdAt: true,
                activatedAt: true,
                lastAccessAt: true,
                event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
            },
        }),
    ]);

    const pageScannerIds = scanners.map((s) => s.id);
    const statsByScannerId = await getCheckInStatsByScannerId(pageScannerIds);

    const items = scanners.map((scanner) => ({
        id: scanner.id,
        personName: buildPersonName(scanner),
        gate: scanner.gate,
        status: scanner.status,
        event: { id: scanner.event.id, title: scanner.event.title },
        organization: scanner.event.organization,
        createdAt: scanner.createdAt,
        activatedAt: scanner.activatedAt,
        lastAccessAt: scanner.lastAccessAt,
        lastScanAt: statsByScannerId.get(scanner.id)?.lastScanAt ?? null,
        checkInsCount: statsByScannerId.get(scanner.id)?.checkInsCount ?? 0,
    }));

    return {
        items,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    };
};

export const getDeveloperScannerService = async (scannerId) => {
    // findFirst (no findUnique): se combina id + deletedAt en el mismo
    // where — mismo patrón que findOwnedScanner en eventScanner.service.js.
    // Un scanner soft-deleted da el mismo 404 que uno inexistente: misma
    // superficie visible que el listado (decisión cerrada en el contrato).
    const scanner = await prisma.eventScanner.findFirst({
        where: { id: scannerId, deletedAt: null },
        select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            gate: true,
            status: true,
            email: true,
            phone: true,
            document: true,
            createdAt: true,
            claimedAt: true,
            activatedAt: true,
            lastAccessAt: true,
            lastDevice: true,
            event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
        },
    });
    if (!scanner) throw new AppError(ErrorCodes.EVENT_SCANNER_NOT_FOUND);

    const [checkInsCount, checkIns] = await Promise.all([
        prisma.checkIn.count({ where: { scannerId } }),
        prisma.checkIn.findMany({
            where: { scannerId },
            orderBy: [{ scannedAt: "desc" }, { id: "desc" }],
            take: RECENT_CHECKINS_LIMIT,
            select: { id: true, scannedAt: true, source: true, gate: true, device: true },
        }),
    ]);

    return {
        id: scanner.id,
        personName: buildPersonName(scanner),
        internalName: scanner.name,
        status: scanner.status,
        gate: scanner.gate,
        event: { id: scanner.event.id, title: scanner.event.title },
        organization: scanner.event.organization,
        contact: { email: scanner.email, phone: scanner.phone, document: scanner.document },
        createdAt: scanner.createdAt,
        claimedAt: scanner.claimedAt,
        activatedAt: scanner.activatedAt,
        lastAccessAt: scanner.lastAccessAt,
        lastDevice: scanner.lastDevice,
        checkInsCount,
        checkIns,
    };
};
