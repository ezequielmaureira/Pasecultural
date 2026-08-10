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
