import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

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
    try {
        const row = await prisma.publicLaunchSettings.findFirst({ orderBy: { createdAt: "asc" } });
        if (!row) {
            logger.warn("public launch settings: no hay ninguna fila configurada, tratando como publicLaunchEnabled=false (fail-closed)", {});
            return false;
        }
        return row.publicLaunchEnabled === true;
    } catch (err) {
        logger.error(err, { context: "public launch settings: no se pudo leer el estado, tratando como publicLaunchEnabled=false (fail-closed)" });
        return false;
    }
}
