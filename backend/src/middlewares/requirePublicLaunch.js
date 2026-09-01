import { isPublicLaunchEnabledOrDefault } from "../services/publicLaunchSettings.service.js";
import { ErrorCatalog } from "../errors/ErrorCatalog.js";
import { isPublicEventPerfLogEnabled } from "../utils/publicEventPerf.js";
import { logger } from "../logging/logger.js";

// Modo Prelanzamiento — guard mínimo y centralizado para endpoints públicos
// de LECTURA que exponen eventos/actividad comercial (listado, detalle,
// búsquedas). NUNCA aplicar a rutas técnicas (webhooks, OAuth, auth,
// endpoints Developer/Organizer autenticados) — ver el comentario en el
// router donde se monta. Verificado sin ningún consumidor interno
// (Organizer/Developer usan endpoints autenticados aparte, nunca estos),
// así que este guard bloquea sin excepción de rol cuando el sitio está
// cerrado.
export async function requirePublicLaunch(req, res, next) {
    // Performance Investigation 3 — instrumentación TEMPORAL (ver
    // utils/publicEventPerf.js). No-op cuando PUBLIC_EVENT_PERF_LOG no está
    // en "true": una sola comparación de string, sin medir tiempo. Este
    // middleware es compartido por organization.routes.js y event.routes.js
    // — `req.params.slug` puede no existir para otras rutas bajo "/public"
    // (ej. el listado), en cuyo caso simplemente se loguea `slug: undefined`.
    const perfEnabled = isPublicEventPerfLogEnabled();
    const perfStartedAt = perfEnabled ? process.hrtime.bigint() : null;

    const enabled = await isPublicLaunchEnabledOrDefault();

    if (perfEnabled) {
        const ms = Math.round(Number(process.hrtime.bigint() - perfStartedAt) / 1e5) / 10;
        logger.info(`[PERF][public-event] requirePublicLaunch ${ms}ms`, { slug: req.params?.slug });
    }

    if (!enabled) {
        const entry = ErrorCatalog.PUBLIC_LAUNCH_DISABLED;
        return res.status(entry.httpStatus).json({ message: entry.userMessage });
    }
    next();
}
