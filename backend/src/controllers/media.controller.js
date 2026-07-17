import { uploadImageService, deleteImageService } from "../services/media.service.js";

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

export const deleteImage = async (req, res) => {
    try {
        const publicId = Array.isArray(req.params.publicId)
            ? req.params.publicId.join("/")
            : req.params.publicId;

        if (!publicId) {
            return res.status(400).json({ message: "Falta el publicId" });
        }

        const result = await deleteImageService(publicId);

        if (result.result !== "ok" && result.result !== "not found") {
            return res.status(500).json({ message: "No se pudo eliminar la imagen" });
        }

        res.status(200).json({ message: "Imagen eliminada", publicId });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al eliminar la imagen",
        });
    }
};
