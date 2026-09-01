import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

// Performance — cache en memoria del proceso para isPublicLaunchEnabledOrDefault().
// Objetivo único: evitar pegarle a Postgres en CADA request público (hoy
// corre en 4 endpoints vía requirePublicLaunch) por un flag que casi nunca
// cambia. Sólo en memoria (sin Redis, sin dependencias nuevas) — no
// compartido entre instancias/procesos de Render; el peor caso ante
// múltiples instancias es que cada una quede con su propia copia hasta que
// expire su propio TTL, nunca un comportamiento inseguro (ver más abajo).
//
// TTL: 60s. Invalidado INMEDIATAMENTE por setPublicLaunchEnabledService
// tras un update exitoso — el Developer que apaga/prende el sitio no tiene
// que esperar el TTL para que su propio cambio tome efecto en ESTA
// instancia. Otras instancias de Render (si las hubiera) sólo lo verían
// reflejado al vencer su propio TTL local (máximo 60s) — mismo tipo de
// staleness ya aceptado explícitamente por el diseño fail-closed de esta
// función (nunca "fail-open").
let cacheTtlMs = 60_000;
let cachedValue = null;
let cachedAt = 0;

function isCacheValid() {
    return cachedValue !== null && Date.now() - cachedAt < cacheTtlMs;
}

function setCache(value) {
    cachedValue = value;
    cachedAt = Date.now();
}

function invalidatePublicLaunchCache() {
    cachedValue = null;
    cachedAt = 0;
}

// Exclusivamente para tests — nunca usado desde código productivo. Permite
// simular la expiración del TTL sin esperar 60s reales en la suite.
export function __setPublicLaunchCacheTtlMsForTests(ms) {
    cacheTtlMs = ms;
}

// Modo Prelanzamiento — mismo criterio de fila única ("singleton") que
// developerAlertConfig.service.js: siempre se lee/reemplaza la primera fila
// por createdAt, nunca hay que resolver "cuál" fila.
//
// A diferencia de DeveloperAlertConfig (informativo, falla ABIERTO a
// DEFAULTS si no se puede leer), acá el criterio es el opuesto a propósito:
// isPublicLaunchEnabledOrDefault() falla CERRADO — cualquier problema para
// determinar el estado (fila borrada, DB caída) se trata como
// publicLaunchEnabled=false. "No sé el estado" tiene que significar
// "protegido", nunca "dejar pasar".

function serializeSettings(row) {
    return {
        id: row.id,
        publicLaunchEnabled: row.publicLaunchEnabled,
        updatedAt: row.updatedAt,
    };
}

// Developer > Configuración — sí lanza si la fila no existe (caso
// anómalo: borrada a mano, la migración la siembra). El panel necesita
// saberlo explícito para poder recrearla.
export async function getPublicLaunchSettingsService() {
    const row = await prisma.publicLaunchSettings.findFirst({ orderBy: { createdAt: "asc" } });
    if (!row) throw new AppError(ErrorCodes.PUBLIC_LAUNCH_SETTINGS_MISSING);
    return serializeSettings(row);
}

// userId ya resuelto por el controller (req.dbUser.id, ver requireRole) —
// mismo criterio que replaceDeveloperAlertConfigService.
export async function setPublicLaunchEnabledService(userId, value) {
    if (typeof value !== "boolean") {
        throw new AppError(ErrorCodes.PUBLIC_LAUNCH_SETTINGS_INVALID);
    }

    const existing = await prisma.publicLaunchSettings.findFirst({ orderBy: { createdAt: "asc" } });
    const row = existing
        ? await prisma.publicLaunchSettings.update({ where: { id: existing.id }, data: { publicLaunchEnabled: value, updatedByUserId: userId } })
        : await prisma.publicLaunchSettings.create({ data: { publicLaunchEnabled: value, updatedByUserId: userId } });

    // Invalidación inmediata — el cambio del Developer nunca debe esperar
    // el TTL para tomar efecto en esta misma instancia.
    invalidatePublicLaunchCache();

    logger.info("public launch settings changed", { updatedByUserId: userId, publicLaunchEnabled: value });
    return serializeSettings(row);
}

// ÚNICO punto que el resto del sistema (guards de Sale, lectura pública de
// eventos, endpoint público de estado) usa para decidir si la superficie
// pública está habilitada. NUNCA lanza — y a diferencia de
// getDeveloperAlertConfigOrDefaults, el valor de caída es SIEMPRE `false`
// (bloqueado), nunca un default "abierto". Cualquier fallo queda
// registrado en logs, nunca en silencio total.
export async function isPublicLaunchEnabledOrDefault() {
    if (isCacheValid()) return cachedValue;

    try {
        const row = await prisma.publicLaunchSettings.findFirst({ orderBy: { createdAt: "asc" } });
        if (!row) {
            logger.warn("public launch settings: no hay ninguna fila configurada, tratando como publicLaunchEnabled=false (fail-closed)", {});
            setCache(false);
            return false;
        }
        const value = row.publicLaunchEnabled === true;
        setCache(value);
        return value;
    } catch (err) {
        logger.error(err, { context: "public launch settings: no se pudo leer el estado, tratando como publicLaunchEnabled=false (fail-closed)" });
        // Nunca se cachea un error transitorio: si la DB se recupera antes
        // de que venza un TTL de 60s, el próximo request ya debe poder
        // volver a leerla, en vez de quedar fail-closed cacheado de más.
        return false;
    }
}
