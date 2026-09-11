import cloudinary from "../config/cloudinary.js";

// Única fuente de verdad de qué imagen es aceptable en toda la plataforma
// (antes vivía sólo, duplicable, en media.routes.js#ALLOWED_MIME_TYPES/
// MAX_FILE_SIZE) — reusada tal cual por el upload web (multer, ver
// media.routes.js) y por el adaptador de imágenes de WhatsApp (ver
// whatsappMediaUpload.service.js), para que ambos caminos exijan
// exactamente la misma política sin mantener dos copias del mismo número.
export const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;

export const uploadImageService = (fileBuffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "image",
                folder: "pasecultural",
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

export const uploadVideoService = (fileBuffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "video",
                folder: "pasecultural",
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
