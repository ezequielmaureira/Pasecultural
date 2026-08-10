import { fetchWhatsappMediaMetadata, downloadWhatsappMedia } from "./whatsapp.service.js";
import { uploadImageService, ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_FILE_SIZE } from "./media.service.js";
import { logger } from "../logging/logger.js";

// Bug fix (carga de imagen del evento) — único punto que conecta
// "mediaId de WhatsApp" con "URL definitiva de Cloudinary". Orquesta:
// Meta Media API (metadata -> URL temporal autorizada) -> descarga de bytes
// -> validación (MIME + tamaño, misma política que /api/media/upload, ver
// media.service.js) -> Cloudinary (uploadImageService, EL MISMO que usa el
// upload web — no se crea una segunda configuración/carpeta/servicio).
// Nunca devuelve ni loguea el WHATSAPP_ACCESS_TOKEN (viaja sólo dentro de
// whatsapp.service.js). Nunca devuelve la URL temporal de Meta como
// resultado exitoso: sólo `secure_url` de Cloudinary cuenta como URL
// definitiva.
//
// Dependencias inyectables (mismo criterio DI que el resto de los
// adaptadores de WhatsApp, ver whatsapp.controller.js) para poder testear
// sin tocar red/Prisma/Cloudinary real.
export async function uploadWhatsappImageMessage(
    mediaId,
    { getMetadata = fetchWhatsappMediaMetadata, downloadMedia = downloadWhatsappMedia, uploadToCloudinary = uploadImageService } = {}
) {
    if (!mediaId) {
        return { success: false, reason: "MISSING_MEDIA_ID" };
    }

    const metadata = await getMetadata(mediaId);
    if (!metadata.success || !metadata.url) {
        logger.warn("whatsapp media upload: no se pudo leer la metadata del media", { reason: "META_METADATA_ERROR" });
        return { success: false, reason: "META_METADATA_ERROR" };
    }

    // Primera validación, con lo que YA confirmó Meta en la metadata —
    // evita gastar la descarga completa de un archivo que ya sabemos que no
    // se va a poder usar.
    if (!ALLOWED_IMAGE_MIME_TYPES.has(metadata.mimeType)) {
        return { success: false, reason: "INVALID_MIME_TYPE" };
    }
    if (typeof metadata.fileSize === "number" && metadata.fileSize > MAX_IMAGE_FILE_SIZE) {
        return { success: false, reason: "FILE_TOO_LARGE" };
    }

    const download = await downloadMedia(metadata.url);
    if (!download.success || !download.buffer) {
        logger.warn("whatsapp media upload: no se pudo descargar el archivo desde Meta", { reason: "META_DOWNLOAD_ERROR" });
        return { success: false, reason: "META_DOWNLOAD_ERROR" };
    }

    // Segunda validación, ahora contra los bytes reales/el content-type real
    // de la descarga — nunca se confía únicamente en lo que reportó la
    // metadata (que a su vez nunca se confía únicamente en lo que mandó el
    // webhook original, ver whatsapp.service.js#normalizeImage).
    if (download.buffer.byteLength > MAX_IMAGE_FILE_SIZE) {
        return { success: false, reason: "FILE_TOO_LARGE" };
    }
    if (download.contentType && !ALLOWED_IMAGE_MIME_TYPES.has(download.contentType)) {
        return { success: false, reason: "INVALID_MIME_TYPE" };
    }

    try {
        const uploaded = await uploadToCloudinary(download.buffer);
        if (!uploaded?.secure_url) {
            return { success: false, reason: "CLOUDINARY_ERROR" };
        }
        return { success: true, url: uploaded.secure_url };
    } catch (error) {
        logger.warn("whatsapp media upload: Cloudinary rechazó la imagen", { reason: "CLOUDINARY_ERROR" });
        return { success: false, reason: "CLOUDINARY_ERROR" };
    }
}
