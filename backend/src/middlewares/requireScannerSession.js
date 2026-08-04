import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { verifyScannerSessionToken } from "../config/scannerSession.js";

// Reemplaza por completo a requireAuth (Clerk) para el módulo Scanner: la
// única prueba de identidad es el scannerSessionToken. El token en sí sólo
// dice "sos este EventScanner.id" — la autorización real (¿sigue ACTIVE?
// ¿no lo borraron/desactivaron/revocaron?) se vuelve a chequear en la base
// EN CADA REQUEST, nunca se confía sólo en la firma/vencimiento del JWT.
// Es lo que hace que desactivar/revocar/eliminar un scanner invalide su
// acceso de inmediato, sin mantener ninguna lista de tokens revocados.
export async function requireScannerSession(req, res, next) {
    try {
        const header = req.get("authorization") || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;
        if (!token) throw new AppError(ErrorCodes.SCANNER_SESSION_INVALID);

        let eventScannerId;
        try {
            ({ eventScannerId } = verifyScannerSessionToken(token));
        } catch {
            throw new AppError(ErrorCodes.SCANNER_SESSION_INVALID);
        }

        const scanner = await prisma.eventScanner.findUnique({
            where: { id: eventScannerId },
            select: { id: true, eventId: true, name: true, gate: true, firstName: true, lastName: true, status: true, deletedAt: true },
        });
        if (!scanner || scanner.deletedAt || scanner.status !== "ACTIVE") {
            throw new AppError(ErrorCodes.SCANNER_SESSION_INVALID);
        }

        req.scanner = scanner;
        next();
    } catch (error) {
        next(AppError.from(error, ErrorCodes.SCANNER_SESSION_INVALID));
    }
}
