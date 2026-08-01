import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { decryptSecret } from "../config/qrEncryption.js";
import { logger } from "../logging/logger.js";

const RESULT_MESSAGES = {
    VALID: "Entrada válida.",
    ALREADY_USED: "La entrada ya fue utilizada.",
    CANCELLED: "La entrada fue cancelada.",
    NOT_FOUND: "Entrada inexistente.",
    WRONG_EVENT: "Esta entrada no corresponde a este evento o función.",
};

function buildTicketInclude() {
    return {
        qr: true,
        buyer: { select: { firstName: true, lastName: true } },
        ticketType: { select: { name: true } },
        event: { select: { title: true } },
    };
}

function buyerName(ticket) {
    return [ticket.buyer?.firstName, ticket.buyer?.lastName].filter(Boolean).join(" ").trim() || null;
}

// Contrato uniforme de respuesta: siempre { status, message, data }, siempre
// HTTP 200 (lo decide el controller). `data` nunca incluye nada que no sea
// necesario para la pantalla del scanner — nunca precios, nunca ids
// internos de Sale, nunca secretEncrypted.
function buildResult(result, { ticket, checkIn, scannerName, gate } = {}) {
    let data = null;

    if (result === "VALID") {
        data = {
            ticketNumber: ticket.ticketNumber,
            buyerName: buyerName(ticket),
            ticketType: ticket.ticketType.name,
            eventName: ticket.event.title,
            scannedAt: checkIn.scannedAt,
            scannerName,
            gate: gate ?? null,
        };
    } else if (result === "ALREADY_USED") {
        data = {
            ticketNumber: ticket.ticketNumber,
            firstScannedAt: checkIn?.scannedAt ?? null,
        };
    } else if (result === "CANCELLED") {
        data = { ticketNumber: ticket.ticketNumber };
    }

    return { status: result, message: RESULT_MESSAGES[result], data };
}

// El corazón del sistema: valida un QR y, si es válido, registra el
// ingreso. Todo dentro de UNA transacción. SIEMPRE registra un ScanAttempt,
// sin importar el resultado (incluso NOT_FOUND/WRONG_EVENT/CANCELLED).
// Nunca lanza un error HTTP por un resultado de negocio — eso es lo que
// devuelve `status`. Los `throw AppError(...)` de acá son únicamente fallas
// reales del sistema (usuario no sincronizado, scanner no autorizado para
// este evento).
export const validateScanService = async (clerkId, input) => {
    const scannerUser = await getUserByClerkId(clerkId);
    if (!scannerUser) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const eventId = input?.eventId;
    const functionId = input?.functionId || null;
    const gate = input?.gate || null;
    const ip = input?.ip || null;
    const userAgent = input?.userAgent || null;

    const eventScanner = await prisma.eventScanner.findUnique({
        where: { eventId_userId: { eventId, userId: scannerUser.id } },
    });
    if (!eventScanner || !eventScanner.active || eventScanner.deletedAt) {
        throw new AppError(ErrorCodes.SCANNER_NOT_AUTHORIZED);
    }

    const scannerName = buyerName({ buyer: scannerUser }) ?? scannerUser.email;

    // Token: "<ticketId>.<secret>" (base64url, sin puntos, por eso alcanza
    // con partir en el primer punto).
    const raw = typeof input?.token === "string" ? input.token : "";
    const separatorIndex = raw.indexOf(".");
    const ticketId = separatorIndex > 0 ? raw.slice(0, separatorIndex) : null;
    const providedSecret = separatorIndex > 0 ? raw.slice(separatorIndex + 1) : null;

    const result = await prisma.$transaction(async (tx) => {
        async function recordAttempt(scanResult, resolvedTicketId) {
            await tx.scanAttempt.create({
                data: { ticketId: resolvedTicketId ?? null, eventId, result: scanResult, scannedBy: scannerUser.id, ip, userAgent },
            });
        }

        if (!ticketId || !providedSecret) {
            await recordAttempt("NOT_FOUND", null);
            return buildResult("NOT_FOUND");
        }

        const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: buildTicketInclude() });
        if (!ticket || ticket.deletedAt) {
            await recordAttempt("NOT_FOUND", null);
            return buildResult("NOT_FOUND");
        }

        let secretMatches;
        try {
            const expectedSecret = decryptSecret(ticket.qr.secretEncrypted);
            const expectedBuffer = Buffer.from(expectedSecret);
            const providedBuffer = Buffer.from(providedSecret);
            secretMatches =
                expectedBuffer.length === providedBuffer.length &&
                crypto.timingSafeEqual(expectedBuffer, providedBuffer);
        } catch {
            secretMatches = false;
        }
        if (!secretMatches) {
            // No se distingue de "no existe": no hay que confirmarle a quien
            // escanea un token adulterado que el ticketId sí era real.
            await recordAttempt("NOT_FOUND", ticket.id);
            return buildResult("NOT_FOUND");
        }

        if (ticket.eventId !== eventId || (functionId && ticket.functionId !== functionId)) {
            await recordAttempt("WRONG_EVENT", ticket.id);
            return buildResult("WRONG_EVENT");
        }

        if (ticket.status === "CANCELLED" || ticket.status === "REFUNDED") {
            await recordAttempt("CANCELLED", ticket.id);
            return buildResult("CANCELLED", { ticket });
        }

        if (ticket.status === "USED") {
            const checkIn = await tx.checkIn.findUnique({ where: { ticketId: ticket.id } });
            await recordAttempt("ALREADY_USED", ticket.id);
            return buildResult("ALREADY_USED", { ticket, checkIn });
        }

        // Update condicional atómico ACTIVE -> USED: si dos escaneos del mismo
        // QR llegan al mismo tiempo, sólo uno encuentra status: ACTIVE todavía.
        const updated = await tx.ticket.updateMany({ where: { id: ticket.id, status: "ACTIVE" }, data: { status: "USED" } });
        if (updated.count === 0) {
            // Perdió la carrera contra otro scan simultáneo.
            const checkIn = await tx.checkIn.findUnique({ where: { ticketId: ticket.id } });
            await recordAttempt("ALREADY_USED", ticket.id);
            return buildResult("ALREADY_USED", { ticket, checkIn });
        }

        // El @unique de CheckIn.ticketId es el último respaldo: si por lo que
        // sea llegaran acá dos escrituras para el mismo ticket (no debería,
        // el updateMany de arriba ya actúa de guard), la segunda create()
        // falla por constraint de la base en vez de duplicar el check-in.
        const checkIn = await tx.checkIn.create({
            data: { ticketId: ticket.id, scannedBy: scannerUser.id, gate },
        });
        await tx.ticketQr.update({ where: { ticketId: ticket.id }, data: { usedAt: new Date() } });
        await recordAttempt("VALID", ticket.id);

        return buildResult("VALID", { ticket, checkIn, scannerName, gate });
    });

    logger.info("Scan validated", { eventId, functionId, scannerId: scannerUser.id, result: result.status });
    return result;
};
