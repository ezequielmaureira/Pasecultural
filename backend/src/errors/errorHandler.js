import { getAuth } from "@clerk/express";
import { AppError } from "./AppError.js";
import { ErrorCodes } from "./ErrorCodes.js";
import { logger } from "../logging/logger.js";

// Único middleware que arma una respuesta de error para toda la app. Los
// controllers no vuelven a decidir status ni shape acá: sólo convierten lo
// que capturan a un AppError (ver AppError.from) y llaman a next(error).
// Se registra una sola vez, al final de app.js.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    const appError = AppError.from(err, ErrorCodes.INTERNAL_ERROR);

    let userId = null;
    try {
        userId = getAuth(req)?.userId ?? null;
    } catch {
        // Si por lo que sea no hay contexto de Clerk en este request, no
        // bloquea el logging del error real.
    }

    logger.error(appError, {
        method: req.method,
        path: req.originalUrl,
        userId,
    });

    res.status(appError.httpStatus).json({
        success: false,
        error: {
            code: appError.code,
            message: appError.userMessage,
            ...(appError.details ? { errors: appError.details } : {}),
        },
        // Shim de compatibilidad: el frontend actual (frontend/src/lib/api.js)
        // sólo lee `body.message`. El día que migre a leer `error.code`, este
        // campo de nivel superior se puede borrar sin romper nada más.
        message: appError.userMessage,
        errorId: appError.errorId,
    });
}
