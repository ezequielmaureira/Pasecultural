import cloudinary from "../config/cloudinary.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

// Única fuente de verdad de qué imagen es aceptable en toda la plataforma
// (antes vivía sólo, duplicable, en media.routes.js#ALLOWED_MIME_TYPES/
// MAX_FILE_SIZE) — reusada tal cual por el upload web (multer, ver
// media.routes.js) y por el adaptador de imágenes de WhatsApp (ver
// whatsappMediaUpload.service.js), para que ambos caminos exijan
// exactamente la misma política sin mantener dos copias del mismo número.
export const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;

// Diagnóstico 2026-09-17 — un JPEG mínimo válido subido directo desde la VM
// de Fly (gru) también terminó en TimeoutError/http_code 499 de Cloudinary,
// con el fallo real observado en producción a los ~6-8s. El SDK corta antes
// de que la latencia real desde esa región alcance a completarse. 30s da
// margen sin dejar requests colgados indefinidamente; no es un retry, sólo
// un timeout más realista para el mismo upload_stream de siempre.
export const CLOUDINARY_UPLOAD_TIMEOUT_MS = 30000;

// Carpeta única de todo lo que sube Smarticket. El borrado (ver
// deleteMediaForUserService) nunca acepta un publicId fuera de ella.
export const MEDIA_FOLDER = "pasecultural";

// Propiedad de un archivo — se graba en el propio recurso de Cloudinary
// (metadata "context"), sin tabla nueva en la base: quién lo subió. Es lo
// que deleteMediaForUserService compara antes de borrar.
export const UPLOADER_CONTEXT_KEY = "uploader_user_id";

function uploaderContext(uploaderUserId) {
    return uploaderUserId ? { context: { [UPLOADER_CONTEXT_KEY]: uploaderUserId } } : {};
}

export const uploadImageService = (fileBuffer, { uploaderUserId = null } = {}) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "image",
                folder: MEDIA_FOLDER,
                timeout: CLOUDINARY_UPLOAD_TIMEOUT_MS,
                ...uploaderContext(uploaderUserId),
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );

        stream.end(fileBuffer);
    });
};

export const deleteImageService = (publicId) => {
    return cloudinary.uploader.destroy(publicId, { resource_type: "image" });
};

// Fest Pass — video de fondo OPCIONAL (ronda "video Cloudinary"). Mismo
// patrón que las imágenes (multer en memoria -> upload_stream a Cloudinary,
// resource_type distinto), nunca una arquitectura paralela. MOV/QuickTime
// aceptado en la subida porque es un formato común de cámara/celular, pero
// la ENTREGA final (ver optimizedVideoUrl en el frontend) siempre pide
// f_auto — Cloudinary transcodifica a MP4/H.264 al servir, así que un MOV
// subido nunca llega crudo al navegador.
export const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 30;

export const uploadVideoService = (fileBuffer, { uploaderUserId = null } = {}) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "video",
                folder: MEDIA_FOLDER,
                timeout: CLOUDINARY_UPLOAD_TIMEOUT_MS,
                ...uploaderContext(uploaderUserId),
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );

        stream.end(fileBuffer);
    });
};

export const deleteVideoService = (publicId) => {
    return cloudinary.uploader.destroy(publicId, { resource_type: "video" });
};

// Función pura (sin red) para poder testearla sin pegarle a Cloudinary —
// Cloudinary devuelve `duration` (segundos, float) en la respuesta de
// upload para todo resource_type:"video". Nunca se confía en una duración
// reportada por el cliente/frontend: esta es la única validación real.
// `duration` ausente/no numérica (no debería pasar para un video real, pero
// por las dudas) se trata como válida — mejor no rechazar de más por un
// dato de Cloudinary que faltó, que romper una subida legítima.
export function isVideoDurationWithinLimit(duration, maxSeconds = MAX_VIDEO_DURATION_SECONDS) {
    if (typeof duration !== "number" || !Number.isFinite(duration)) return true;
    return duration <= maxSeconds;
}

// publicId que genera Cloudinary dentro de MEDIA_FOLDER: segmentos
// alfanuméricos con _ y -, separados por "/". Nada de "..", espacios,
// extensiones, comodines ni otra carpeta.
const PUBLIC_ID_PATTERN = new RegExp(`^${MEDIA_FOLDER}(/[A-Za-z0-9_-]+)+$`);

export function isManagedPublicId(publicId) {
    return typeof publicId === "string" && publicId.length <= 255 && PUBLIC_ID_PATTERN.test(publicId);
}

async function fetchCloudinaryResource(publicId, resourceType) {
    try {
        return await cloudinary.api.resource(publicId, { resource_type: resourceType, context: true });
    } catch (error) {
        const status = error?.error?.http_code ?? error?.http_code;
        if (status === 404) return null;
        throw error;
    }
}

// C3 — DELETE /api/media/*publicId. Antes cualquier usuario logueado podía
// borrar CUALQUIER recurso de la cuenta de Cloudinary (el publicId está en
// todas las URLs públicas). Ahora:
//  - el publicId tiene que ser de MEDIA_FOLDER (isManagedPublicId);
//  - DEVELOPER puede borrar cualquier recurso de esa carpeta;
//  - cualquier otro usuario, sólo lo que subió él mismo (context
//    uploader_user_id grabado al subir). Archivos viejos sin ese dato, o
//    subidos por el bot de WhatsApp, quedan sólo para DEVELOPER — el
//    frontend ya trata el borrado como best-effort, así que en el peor caso
//    el archivo queda huérfano, nunca se borra algo ajeno.
// `deps` sólo existe para los tests (sin red ni Cloudinary real).
export async function deleteMediaForUserService(user, publicId, resourceType, deps = {}) {
    const { fetchResource = fetchCloudinaryResource, destroy = (id, type) => cloudinary.uploader.destroy(id, { resource_type: type }) } = deps;

    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    if (resourceType !== "image" && resourceType !== "video") throw new AppError(ErrorCodes.MEDIA_INVALID_ID);
    if (!isManagedPublicId(publicId)) throw new AppError(ErrorCodes.MEDIA_INVALID_ID);

    if (user.role !== "DEVELOPER") {
        const resource = await fetchResource(publicId, resourceType);
        // No existe: nada que borrar. Misma respuesta para dueño y no dueño,
        // así no sirve para averiguar qué publicIds existen.
        if (!resource) return { result: "not found" };
        const uploader = resource.context?.custom?.[UPLOADER_CONTEXT_KEY] ?? resource.context?.[UPLOADER_CONTEXT_KEY] ?? null;
        if (!uploader || uploader !== user.id) {
            logger.warn("media delete rejected: requester is not the uploader", { userId: user.id, resourceType });
            throw new AppError(ErrorCodes.MEDIA_FORBIDDEN);
        }
    }

    return destroy(publicId, resourceType);
}
