import { AppError } from "../errors/AppError.js";
import { checkInService, scanTicketService } from "../services/scanner.service.js";

// Momento 1: ESCANEAR — sólo lectura, nunca registra nada (ver
// scanTicketService). No necesita ip/userAgent (no hay ScanAttempt que
// loguear todavía, eso recién pasa al confirmar).
export const scanTicket = async (req, res, next) => {
    try {
        const result = await scanTicketService(req.scanner, req.body);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Momento 2: CONFIRMAR EL INGRESO — el único que puede registrar un
// CheckIn. Los resultados de negocio (VALIDO/YA_USADO/CANCELADO/etc.)
// siempre responden 200 — el `status` del body es lo que distingue el
// resultado. Sólo un error real del sistema (AppError) usa un status HTTP
// distinto, vía next(error). req.scanner ya viene resuelto y verificado
// ACTIVE por requireScannerSession — no hay Clerk en este flujo.
export const checkIn = async (req, res, next) => {
    try {
        const result = await checkInService(req.scanner, {
            ...req.body,
            ip: req.ip,
            userAgent: req.get("user-agent") || null,
        });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
