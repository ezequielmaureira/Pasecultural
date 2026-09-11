import {
    uploadImageService,
    deleteImageService,
    uploadVideoService,
    deleteVideoService,
    isVideoDurationWithinLimit,
    MAX_VIDEO_DURATION_SECONDS,
} from "../services/media.service.js";

export const uploadImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No se envió ninguna imagen" });
        }

        const result = await uploadImageService(req.file.buffer);

        res.status(201).json({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al subir la imagen",
        });
    }
};

// Fest Pass — video de fondo opcional. MIME/tamaño ya quedaron validados
// por multer (ver media.routes.js) antes de llegar acá — lo único que
// Cloudinary puede decirnos recién DESPUÉS de subir es la duración real del
// archivo, así que la validación de "<=30s" ocurre acá, sobre la respuesta
// de Cloudinary, nunca confiando en nada que haya mandado el cliente. Si se
// pasa, el recurso ya subido se borra inmediatamente (nunca queda un video
// de más de 30s huérfano en Cloudinary sólo porque se rechazó después).
export const uploadVideo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No se envió ningún video" });
        }

        const result = await uploadVideoService(req.file.buffer);

        if (!isVideoDurationWithinLimit(result.duration)) {
            try {
                await deleteVideoService(result.public_id);
            } catch (cleanupError) {
                console.error("No se pudo eliminar el video rechazado por duración", cleanupError);
            }
            return res.status(400).json({
                message: `El video no puede superar los ${MAX_VIDEO_DURATION_SECONDS} segundos`,
            });
        }

        res.status(201).json({
            url: result.secure_url,
            publicId: result.public_id,
            duration: result.duration,
            width: result.width,
            height: result.height,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al subir el video",
        });
    }
};

// Despacha por resource_type (imagen por default — mismo comportamiento
// exacto que el deleteImage original para cualquier caller que no mande
// `?type=`) — único endpoint de borrado, reusado para imagen y video en vez
// de duplicar la ruta/controller entero sólo por el resource_type.
export const deleteMedia = async (req, res) => {
    try {
        const publicId = Array.isArray(req.params.publicId)
            ? req.params.publicId.join("/")
            : req.params.publicId;

        if (!publicId) {
            return res.status(400).json({ message: "Falta el publicId" });
        }

        const isVideo = req.query.type === "video";
        const result = isVideo ? await deleteVideoService(publicId) : await deleteImageService(publicId);

        if (result.result !== "ok" && result.result !== "not found") {
            return res.status(500).json({ message: isVideo ? "No se pudo eliminar el video" : "No se pudo eliminar la imagen" });
        }

        res.status(200).json({ message: isVideo ? "Video eliminado" : "Imagen eliminada", publicId });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al eliminar el archivo",
        });
    }
};
