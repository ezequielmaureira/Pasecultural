import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";

// Única fuente de verdad de "¿puede este usuario escanear/leer datos de
// ESTE evento?" — antes vivía sólo dentro de validate(); ahora también la
// necesitan los endpoints de lectura del scanner (eventos, stats,
// historial), así que se extrajo para no duplicarla 4 veces.
export async function assertScannerAuthorized(client, eventId, userId) {
    const eventScanner = await client.eventScanner.findUnique({
        where: { eventId_userId: { eventId, userId } },
    });
    if (!eventScanner || eventScanner.status !== "ACTIVE" || eventScanner.deletedAt) {
        throw new AppError(ErrorCodes.SCANNER_NOT_AUTHORIZED);
    }
}
