import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";

// Corta ANTES de que el controller llegue a llamar al service — capa 1 de
// 2 (la segunda vive dentro de cada función de devTools.service.js, por si
// alguna vez algo llama al service sin pasar por esta ruta). Gatea las 3
// rutas del módulo por igual (stats/reset/demo), no sólo las destructivas:
// esta herramienta no tiene ningún motivo para existir fuera de desarrollo.
export function requireDevelopmentEnv(req, res, next) {
    if (process.env.NODE_ENV === "production") {
        return next(new AppError(ErrorCodes.DEV_TOOLS_UNAVAILABLE));
    }
    next();
}
