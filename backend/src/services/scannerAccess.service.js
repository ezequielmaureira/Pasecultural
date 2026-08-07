import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";

// Única fuente de verdad para "¿este scanner realmente tiene acceso a este
// evento?" — reutilizada por checkInService, getFunctionStatsService,
// listScanAttemptsService y getScannerDashboardService. `scannerContext` es
// req.scanner (el EventScanner "ancla" con el que se inició sesión, ya
// verificado ACTIVE por requireScannerSession).
//
// Camino rápido (sin query): si no se pide ningún eventId, o el pedido es
// el mismo del ancla, se devuelve scannerContext tal cual — CERO consultas
// extra, mismo comportamiento exacto que antes de que existiera este
// helper. Un scanner con un solo evento asignado NUNCA cae en la otra rama.
//
// Camino con verificación: si se pide un eventId distinto, se busca en la
// base si existe una fila EventScanner ACTIVE con el MISMO email para ESE
// evento — nunca se confía en el eventId del cliente sin esa comprobación.
// Si no hay match, SCANNER_NOT_AUTHORIZED. Si hay match, se devuelve ESA
// fila (no la del ancla): tiene su propio id/gate/name, que es lo que hay
// que usar para atribuir un CheckIn/ScanAttempt al evento correcto.
export async function resolveScannerAccess(scannerContext, eventId) {
    if (!eventId || eventId === scannerContext.eventId) {
        return scannerContext;
    }
    if (!scannerContext.email) {
        throw new AppError(ErrorCodes.SCANNER_NOT_AUTHORIZED);
    }

    const match = await prisma.eventScanner.findFirst({
        where: { email: scannerContext.email, eventId, status: "ACTIVE", deletedAt: null },
        select: { id: true, eventId: true, name: true, gate: true, firstName: true, lastName: true, status: true, email: true },
    });
    if (!match) {
        throw new AppError(ErrorCodes.SCANNER_NOT_AUTHORIZED);
    }
    return match;
}
