import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { logger } from "../logging/logger.js";
import { runArchiveSelfHeal } from "./eventArchive.service.js";
import { getLimitForOrganization, PlanLimitKey } from "./organizationPlanPolicy.js";

// Cuánto dura una invitación sin reclamar antes de considerarse vencida —
// "vencimiento configurable" del requerimiento: el campo lo soporta
// (invitationExpiresAt), este es sólo el default con el que arranca cada
// invitación nueva. Generar una invitación nueva reinicia el plazo.
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const MAX_QUANTITY = 20;

function generateInvitationToken() {
    // Mismo generador que Sale.publicRecoveryToken (crypto.randomBytes, no
    // Math.random ni un cuid): esto viaja en una URL pública, tiene que ser
    // impredecible.
    return crypto.randomBytes(32).toString("base64url");
}

async function getMyOrganization(clerkId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) return null;

    const organization = await prisma.organization.findFirst({ where: { ownerId: user.id } });
    if (!organization) return null;

    return { user, organization };
}

// Exportada para ticketAdmin.service.js y functionCapacity.service.js —
// mismo criterio de "el organizador dueño de este evento" que ya usan todas
// las acciones de scanner de acá abajo, reusado tal cual para acciones de
// ticket y estado de funciones. Punto único de rechazo para "evento
// archivado": al centralizarlo acá, Scanners (list/crear/editar/
// deshabilitar/etc.), Entradas (cancelar/rehabilitar/marcar usada/eliminar)
// y Estado de Funciones quedan protegidos con un solo cambio — nunca hace
// falta repetir este chequeo en cada service.
export async function getOwnedEvent(clerkId, eventId) {
    const context = await getMyOrganization(clerkId);
    if (!context) return null;

    await runArchiveSelfHeal(prisma, { eventId });

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.organizationId !== context.organization.id) return null;
    if (event.archivedAt) throw new AppError(ErrorCodes.EVENT_ARCHIVED);

    return { ...context, event };
}

const SCANNER_SELECT = {
    id: true,
    name: true,
    gate: true,
    status: true,
    invitationToken: true,
    invitationExpiresAt: true,
    createdAt: true,
    updatedAt: true,
    claimedAt: true,
    activatedAt: true,
    lastAccessAt: true,
    lastDevice: true,
    // lastScanAt (columna) NO se selecciona a propósito: nada la escribe
    // nunca (ver confirmScanService en scanner.service.js) — quedaría
    // siempre null. listEventScannersService calcula el valor real por
    // separado, desde CheckIn.scannedAt.
    // Datos del registro (paso 3 del formulario público) — única identidad
    // que existe de esta persona, no hay cuenta/User detrás.
    firstName: true,
    lastName: true,
    document: true,
    email: true,
    phone: true,
};

async function findOwnedScanner(eventId, scannerId) {
    const scanner = await prisma.eventScanner.findFirst({
        where: { id: scannerId, eventId, deletedAt: null },
        select: SCANNER_SELECT,
    });
    if (!scanner) throw new AppError(ErrorCodes.EVENT_SCANNER_NOT_FOUND);
    return scanner;
}

// Premium — Fase 2B. Scanner que consume cupo de maxScannersPerEvent:
// deletedAt IS NULL AND status != REVOKED (decisión de producto aprobada —
// INVITED/ACTIVE/DISABLED cuentan, una invitación sin reclamar ocupa un
// lugar igual). Advisory lock scoped por evento: serializa únicamente altas
// concurrentes de scanners del MISMO evento, nunca bloquea otro evento.
// Mismo mecanismo que acquireMercadoPagoConnectionLock
// (mercadoPagoConnection.service.js) — DEBE tomarse con `tx`.
async function acquireScannerQuotaLock(tx, eventId) {
    await tx.$queryRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked`,
        `scanners:${eventId}`
    );
}

// Eventos que el asistente conversacional ofrece en el Paso 1 — "activos"
// significa que todavía tiene sentido asignarles un scanner (no
// cancelado, no ya terminado). DRAFT/SCHEDULED/PUBLISHED cuentan: un
// organizador puede querer dejar scanners listos antes de publicar.
export const listActiveEventsForScannerService = async (clerkId) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return [];

    await runArchiveSelfHeal(prisma, { organizationId: context.organization.id });

    return prisma.event.findMany({
        where: {
            organizationId: context.organization.id,
            status: { notIn: ["CANCELLED", "FINISHED"] },
            archivedAt: null,
        },
        select: { id: true, title: true },
        orderBy: { createdAt: "desc" },
    });
};

// "Cantidad de ingresos" y "último escaneo" reales (Iteración 1 del
// Dashboard del Organizador, sección Scanners) — CheckIn.scannerId no es una
// relación formal (String suelto, ver schema.prisma) pero SÍ es el id real
// de EventScanner en cada escaneo válido (ver confirmScanService), así que
// un groupBy sobre esa columna es la única fuente correcta. Nunca se usa
// EventScanner.lastScanAt: esa columna está preparada en el schema pero
// ningún caller la escribe todavía.
export const listEventScannersService = async (clerkId, eventId) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const scanners = await prisma.eventScanner.findMany({
        where: { eventId, deletedAt: null },
        select: SCANNER_SELECT,
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
        ...scanner,
        checkInsCount: statsByScannerId.get(scanner.id)?.checkInsCount ?? 0,
        lastScanAt: statsByScannerId.get(scanner.id)?.lastScanAt ?? null,
    }));
};

// Paso 4 del asistente: crea `quantity` invitaciones iguales para la misma
// puerta, cada una con su propio token único — nunca un token compartido
// entre varias (cada scanner físico/persona necesita poder revocarse
// individualmente sin tumbar a los demás de la misma puerta).
export const createScannerInvitationsService = async (clerkId, eventId, { gate, quantity }) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const trimmedGate = gate?.trim();
    if (!trimmedGate) throw new AppError(ErrorCodes.SCANNER_GATE_REQUIRED);

    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > MAX_QUANTITY) {
        throw new AppError(ErrorCodes.SCANNER_QUANTITY_INVALID);
    }

    const buildRows = (existingForGate) => {
        const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
        return Array.from({ length: parsedQuantity }, (_, i) => ({
            eventId,
            gate: trimmedGate,
            name: `${trimmedGate} #${existingForGate + i + 1}`,
            status: "INVITED",
            invitationToken: generateInvitationToken(),
            invitationExpiresAt: expiresAt,
            createdBy: owned.user.id,
        }));
    };

    // Premium — Fase 2B. `limit` se lee ANTES de decidir si hace falta
    // transacción/lock: si el plan no tiene tope configurado (null = sin
    // límite, fallback seguro de Fase 2A), el camino queda IDÉNTICO al de
    // antes de esta fase (mismas 2 llamadas sueltas, sin transacción) — cero
    // costo extra para el caso por default. Sólo cuando hay un número real
    // se paga el lock + el segundo count, y TODO (lock, conteo, createMany)
    // pasa a ocurrir dentro de la MISMA transacción para cerrar la carrera
    // "count() -> comparar -> createMany()" entre dos altas concurrentes del
    // mismo evento. `quantity` completo se valida contra el remanente ANTES
    // de crear nada: una request que excede el cupo se rechaza entera, nunca
    // crea parcialmente.
    const limit = await getLimitForOrganization(owned.organization, PlanLimitKey.SCANNERS_PER_EVENT);

    let rows;
    if (limit === null) {
        const existingForGate = await prisma.eventScanner.count({
            where: { eventId, gate: trimmedGate, deletedAt: null },
        });
        rows = buildRows(existingForGate);
        await prisma.eventScanner.createMany({ data: rows });
    } else {
        rows = await prisma.$transaction(async (tx) => {
            await acquireScannerQuotaLock(tx, eventId);

            const [existingForGate, activeCount] = await Promise.all([
                tx.eventScanner.count({ where: { eventId, gate: trimmedGate, deletedAt: null } }),
                tx.eventScanner.count({ where: { eventId, deletedAt: null, status: { not: "REVOKED" } } }),
            ]);

            if (activeCount + parsedQuantity > limit) {
                throw new AppError(ErrorCodes.PLAN_SCANNER_LIMIT_REACHED);
            }

            const newRows = buildRows(existingForGate);
            await tx.eventScanner.createMany({ data: newRows });
            return newRows;
        });
    }

    logger.info("createScannerInvitationsService completed", {
        eventId,
        gate: trimmedGate,
        quantity: parsedQuantity,
        createdBy: owned.user.id,
    });

    // Se devuelven completas (incluye invitationToken): es la única vez que
    // el organizador puede copiarlas recién creadas desde la pantalla de
    // "compartir" del asistente.
    return prisma.eventScanner.findMany({
        where: { invitationToken: { in: rows.map((r) => r.invitationToken) } },
        select: SCANNER_SELECT,
        orderBy: { createdAt: "asc" },
    });
};

export const updateScannerService = async (clerkId, eventId, scannerId, { name, gate }) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    await findOwnedScanner(eventId, scannerId);

    const data = {};
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (typeof gate === "string" && gate.trim()) data.gate = gate.trim();

    return prisma.eventScanner.update({ where: { id: scannerId }, data, select: SCANNER_SELECT });
};

export const disableScannerService = async (clerkId, eventId, scannerId) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    const scanner = await findOwnedScanner(eventId, scannerId);
    if (scanner.status !== "ACTIVE") throw new AppError(ErrorCodes.SCANNER_INVALID_TRANSITION);

    return prisma.eventScanner.update({ where: { id: scannerId }, data: { status: "DISABLED" }, select: SCANNER_SELECT });
};

export const reactivateScannerService = async (clerkId, eventId, scannerId) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    const scanner = await findOwnedScanner(eventId, scannerId);
    if (scanner.status !== "DISABLED") throw new AppError(ErrorCodes.SCANNER_INVALID_TRANSITION);

    return prisma.eventScanner.update({ where: { id: scannerId }, data: { status: "ACTIVE" }, select: SCANNER_SELECT });
};

// "Eliminar": soft delete (mismo criterio que el resto de la app) — saca la
// fila de todas las listas/autorización, pero conserva la auditoría en la
// base en vez de borrarla de verdad.
export const deleteScannerService = async (clerkId, eventId, scannerId) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    await findOwnedScanner(eventId, scannerId);

    await prisma.eventScanner.update({ where: { id: scannerId }, data: { deletedAt: new Date() } });
};

// "Revocar invitación": termina la fila sin borrarla — a diferencia de
// Eliminar, queda visible en la lista como REVOKED (auditoría de que
// existió y se canceló). Se puede revocar desde cualquier estado no
// terminal; es intencionalmente más fuerte que Desactivar (que sólo se
// puede deshacer con Reactivar).
export const revokeScannerInvitationService = async (clerkId, eventId, scannerId) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    const scanner = await findOwnedScanner(eventId, scannerId);
    if (scanner.status === "REVOKED") throw new AppError(ErrorCodes.SCANNER_INVALID_TRANSITION);

    return prisma.eventScanner.update({ where: { id: scannerId }, data: { status: "REVOKED" }, select: SCANNER_SELECT });
};

// "Generar nueva invitación": sólo tiene sentido si todavía nadie la
// completó (INVITED) o si se había revocado/vencido — nunca sobre una que
// ya está ACTIVE/DISABLED (Editar/Desactivar/Revocar, no esto). Token
// nuevo, vencimiento reiniciado, vuelve a INVITED — y se limpia cualquier
// registro/código a medio terminar de un intento anterior, para que la
// invitación quede realmente "en blanco" otra vez.
export const regenerateScannerInvitationService = async (clerkId, eventId, scannerId) => {
    const owned = await getOwnedEvent(clerkId, eventId);
    if (!owned) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    const scanner = await findOwnedScanner(eventId, scannerId);
    if (scanner.status !== "INVITED" && scanner.status !== "REVOKED") {
        throw new AppError(ErrorCodes.SCANNER_INVITATION_NOT_ELIGIBLE);
    }

    return prisma.eventScanner.update({
        where: { id: scannerId },
        data: {
            status: "INVITED",
            invitationToken: generateInvitationToken(),
            invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
            firstName: null,
            lastName: null,
            document: null,
            email: null,
            phone: null,
            verificationCodeHash: null,
            verificationCodeExpiresAt: null,
            verificationAttempts: 0,
            verificationLastSentAt: null,
            claimedAt: null,
        },
        select: SCANNER_SELECT,
    });
};
