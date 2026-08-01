import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { validateScanService } from "../services/scanner.service.js";

// Los resultados de negocio (VALIDO/YA_USADO/CANCELADO/etc.) siempre
// responden 200 — el `status` del body es lo que distingue el resultado.
// Sólo un error real del sistema (AppError) usa un status HTTP distinto,
// vía next(error).
export const validateScan = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await validateScanService(userId, {
            ...req.body,
            ip: req.ip,
            userAgent: req.get("user-agent") || null,
        });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
