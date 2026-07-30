import crypto from "node:crypto";
import { ErrorCatalog } from "./ErrorCatalog.js";
import { ErrorCodes } from "./ErrorCodes.js";

// Único tipo de error "de negocio" de toda la aplicación. No decide nada
// por sí mismo (no arma respuestas HTTP, no loguea): sólo empaqueta un
// código ya existente en ErrorCatalog junto con el status HTTP y los dos
// mensajes que le corresponden, más un errorId propio para poder rastrear
// el incidente en los logs a partir de lo que ve el usuario.
export class AppError extends Error {
    constructor(code, { cause, details } = {}) {
        const entry = ErrorCatalog[code];
        if (!entry) {
            throw new Error(`Unknown error code: "${code}". Agregalo a ErrorCatalog.js antes de usarlo.`);
        }

        super(entry.logMessage);
        this.name = "AppError";
        this.code = code;
        this.httpStatus = entry.httpStatus;
        this.userMessage = entry.userMessage;
        this.details = details;
        this.errorId = crypto.randomUUID();
        if (cause) this.cause = cause;
        Error.captureStackTrace?.(this, AppError);
    }

    // Normaliza cualquier error capturado en un catch a un AppError:
    //  - si ya es AppError, lo devuelve tal cual (conserva su errorId/código).
    //  - si es un error "legacy" (throw new Error("CODE") de un service que
    //    todavía no migró a AppError) cuyo .message coincide con un código
    //    existente en ErrorCatalog, lo envuelve con ESE código — mismo
    //    status/mensaje que ya tenía antes de esta migración.
    //  - en cualquier otro caso (error inesperado, de infraestructura, etc.),
    //    lo envuelve con `fallbackCode` y guarda el error original en
    //    `cause` para que quede completo en los logs.
    // No decide de negocio acá: sólo reconoce y convierte. Qué código le
    // corresponde a cada situación sigue siendo una decisión del
    // controller/service que la lanza.
    static from(error, fallbackCode = ErrorCodes.INTERNAL_ERROR) {
        if (error instanceof AppError) return error;

        if (error?.message && ErrorCatalog[error.message]) {
            return new AppError(error.message, { cause: error });
        }

        return new AppError(fallbackCode, { cause: error });
    }
}
