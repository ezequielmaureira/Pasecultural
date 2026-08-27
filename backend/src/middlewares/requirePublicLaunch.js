import { isPublicLaunchEnabledOrDefault } from "../services/publicLaunchSettings.service.js";
import { ErrorCatalog } from "../errors/ErrorCatalog.js";

// Modo Prelanzamiento — guard mínimo y centralizado para endpoints públicos
// de LECTURA que exponen eventos/actividad comercial (listado, detalle,
// búsquedas). NUNCA aplicar a rutas técnicas (webhooks, OAuth, auth,
// endpoints Developer/Organizer autenticados) — ver el comentario en el
// router donde se monta. Verificado sin ningún consumidor interno
// (Organizer/Developer usan endpoints autenticados aparte, nunca estos),
// así que este guard bloquea sin excepción de rol cuando el sitio está
// cerrado.
export async function requirePublicLaunch(req, res, next) {
    const enabled = await isPublicLaunchEnabledOrDefault();
    if (!enabled) {
        const entry = ErrorCatalog.PUBLIC_LAUNCH_DISABLED;
        return res.status(entry.httpStatus).json({ message: entry.userMessage });
    }
    next();
}
