import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";

// Quién puede escanear un evento no depende de un rol especial de cuenta
// (Role.SCANNER quedó en el enum de Prisma por compatibilidad, pero ya no
// se usa como gate de autorización — ver scanner.service.js) sino
// exclusivamente de tener una fila activa en EventScanner. Este service es
// el lado del organizador: quién puede agregar/quitar esas filas.
async function getMyOrganization(clerkId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) return null;

    const organization = await prisma.organization.findFirst({ where: { ownerId: user.id } });
    if (!organization) return null;

    return { user, organization };
}

async function getOwnedEvent(clerkId, eventId) {
    const context = await getMyOrganization(clerkId);
    if (!context) return null;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.organizationId !== context.organization.id) return null;

    return event;
}

const SCANNER_SELECT = {
    id: true,
    active: true,
    createdAt: true,
    user: { select: { id: true, firstName: true, lastName: true, email: true } },
};

export const listEventScannersService = async (clerkId, eventId) => {
    const event = await getOwnedEvent(clerkId, eventId);
    if (!event) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    return prisma.eventScanner.findMany({
        where: { eventId, deletedAt: null },
        select: SCANNER_SELECT,
        orderBy: { createdAt: "asc" },
    });
};

// No existe un sistema de invitación por email (no se implementan emails en
// esta fase): el organizador sólo puede habilitar a alguien que ya tiene
// una cuenta en PaseCultural (comprador, organizador de otro evento, etc.)
// — exactamente lo que permite "un mismo usuario, varios roles a la vez".
// Si el email no tiene cuenta todavía, se le pide que se registre primero.
export const addEventScannerService = async (clerkId, eventId, email) => {
    const event = await getOwnedEvent(clerkId, eventId);
    if (!event) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) throw new AppError(ErrorCodes.EVENT_SCANNER_EMAIL_REQUIRED);

    const targetUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!targetUser) throw new AppError(ErrorCodes.EVENT_SCANNER_USER_NOT_FOUND);

    // upsert: si ya existía (activo o soft-deleted) lo reactiva en vez de
    // violar el @@unique([eventId, userId]) con un create() directo.
    return prisma.eventScanner.upsert({
        where: { eventId_userId: { eventId, userId: targetUser.id } },
        update: { active: true, deletedAt: null },
        create: { eventId, userId: targetUser.id, active: true },
        select: SCANNER_SELECT,
    });
};

export const removeEventScannerService = async (clerkId, eventId, targetUserId) => {
    const event = await getOwnedEvent(clerkId, eventId);
    if (!event) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const updated = await prisma.eventScanner.updateMany({
        where: { eventId, userId: targetUserId, deletedAt: null },
        data: { active: false, deletedAt: new Date() },
    });
    if (updated.count === 0) throw new AppError(ErrorCodes.EVENT_SCANNER_NOT_FOUND);
};
