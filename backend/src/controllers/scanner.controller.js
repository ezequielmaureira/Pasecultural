import { AppError } from "../errors/AppError.js";
import { validateScanService, previewScanService } from "../services/scanner.service.js";

// Paso 1 del flujo de dos fases: sólo lectura, nunca registra nada — ver
// previewScanService. No necesita ip/userAgent (no hay ScanAttempt que
// loguear todavía).
export const previewScan = async (req, res, next) => {
    try {
        const result = await previewScanService(req.scanner, req.body);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Los resultados de negocio (VALIDO/YA_USADO/CANCELADO/etc.) siempre
// responden 200 — el `status` del body es lo que distingue el resultado.
// Sólo un error real del sistema (AppError) usa un status HTTP distinto,
// vía next(error). req.scanner ya viene resuelto y verificado ACTIVE por
// requireScannerSession — no hay Clerk en este flujo.
export const validateScan = async (req, res, next) => {
    try {
        const result = await validateScanService(req.scanner, {
            ...req.body,
            ip: req.ip,
            userAgent: req.get("user-agent") || null,
        });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
