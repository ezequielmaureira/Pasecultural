import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { logger } from "../logging/logger.js";

// Sólo lo necesario para que la pantalla pública de invitación se arme
// ANTES de que la persona inicie sesión — nunca id interno, nunca datos de
// otros scanners de la misma puerta.
export const getScannerInvitationService = async (token) => {
    if (!token) throw new AppError(ErrorCodes.SCANNER_INVITATION_NOT_FOUND);

    const scanner = await prisma.eventScanner.findUnique({
        where: { invitationToken: token },
        select: {
            status: true,
            gate: true,
            name: true,
            invitationExpiresAt: true,
            deletedAt: true,
            event: { select: { title: true } },
        },
    });
    if (!scanner || scanner.deletedAt) throw new AppError(ErrorCodes.SCANNER_INVITATION_NOT_FOUND);

    const expired = scanner.status === "INVITED" && scanner.invitationExpiresAt && scanner.invitationExpiresAt < new Date();

    return {
        eventTitle: scanner.event.title,
        gate: scanner.gate,
        name: scanner.name,
        status: expired ? "EXPIRED" : scanner.status,
    };
};

// Reclamo de la invitación: se llama recién con sesión de Clerk ya
// resuelta (el frontend redirige a iniciar-sesión/registro ANTES de
// llegar acá si hace falta). Idempotente para la MISMA persona reabriendo
// su propio link — nunca lanza error por eso, sólo por intentar reclamar
// la invitación de otro o una ya vencida/revocada.
export const claimScannerInvitationService = async (clerkId, token, { userAgent } = {}) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const scanner = await prisma.eventScanner.findUnique({
        where: { invitationToken: token },
        select: { id: true, eventId: true, userId: true, status: true, invitationExpiresAt: true, deletedAt: true },
    });
    if (!scanner || scanner.deletedAt) throw new AppError(ErrorCodes.SCANNER_INVITATION_NOT_FOUND);

    if (scanner.status === "REVOKED") throw new AppError(ErrorCodes.SCANNER_INVITATION_REVOKED);

    if (scanner.status !== "INVITED") {
        // PENDING/ACTIVE/DISABLED: ya tiene un userId asignado. Reabrir el
        // mismo link con la misma cuenta es sólo "che, ¿cómo va mi
        // solicitud?" — se responde con el estado actual en vez de tirar
        // error. Otra persona intentando el mismo link sí es un error real.
        if (scanner.userId === user.id) {
            return prisma.eventScanner.findUnique({
                where: { id: scanner.id },
                select: { status: true, gate: true, name: true, event: { select: { title: true } } },
            });
        }
        throw new AppError(ErrorCodes.SCANNER_INVITATION_ALREADY_CLAIMED);
    }

    if (scanner.invitationExpiresAt && scanner.invitationExpiresAt < new Date()) {
        // Se aprovecha para dejar registrado que venció, en vez de quedar
        // "INVITED" para siempre mostrando un estado que ya no es real.
        await prisma.eventScanner.update({ where: { id: scanner.id }, data: { status: "REVOKED" } });
        throw new AppError(ErrorCodes.SCANNER_INVITATION_EXPIRED);
    }

    // Respeta @@unique([eventId, userId]): si esta persona ya tiene otra
    // fila no revocada/no eliminada para el MISMO evento (otra puerta, por
    // ejemplo), no puede reclamar una segunda — se lo dice claro en vez de
    // dejar que el constraint de la base tire un error crudo.
    const existingForEvent = await prisma.eventScanner.findFirst({
        where: { eventId: scanner.eventId, userId: user.id, deletedAt: null, status: { not: "REVOKED" } },
    });
    if (existingForEvent) throw new AppError(ErrorCodes.SCANNER_INVITATION_ALREADY_ASSIGNED);

    const now = new Date();
    const updated = await prisma.eventScanner.update({
        where: { id: scanner.id },
        data: { userId: user.id, status: "PENDING", claimedAt: now, lastAccessAt: now, lastDevice: userAgent ?? null },
        select: { status: true, gate: true, name: true, event: { select: { title: true } } },
    });

    logger.info("claimScannerInvitationService completed", { eventScannerId: scanner.id, eventId: scanner.eventId });
    return updated;
};
