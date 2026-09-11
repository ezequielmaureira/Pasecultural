import { Router } from "express";
import multer from "multer";
import { uploadImage, uploadVideo, deleteMedia } from "../controllers/media.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
    ALLOWED_IMAGE_MIME_TYPES,
    MAX_IMAGE_FILE_SIZE,
    ALLOWED_VIDEO_MIME_TYPES,
    MAX_VIDEO_FILE_SIZE,
} from "../services/media.service.js";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
            return cb(new Error("INVALID_FILE_TYPE"));
        }
        cb(null, true);
    },
});

function handleUpload(req, res, next) {
    upload.single("file")(req, res, (error) => {
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: "La imagen no puede superar los 5 MB" });
        }
        if (error?.message === "INVALID_FILE_TYPE") {
            return res
                .status(400)
                .json({ message: "Formato no soportado. Usá PNG, JPG, JPEG o WEBP" });
        }
        if (error) {
            return res.status(400).json({ message: "No se pudo procesar la imagen" });
        }
        next();
    });
}

// Fest Pass — video de fondo opcional. Instancia de multer PROPIA (límite
// de tamaño mucho mayor que el de imagen, 100 MB vs 5 MB — nunca se
// reutiliza `upload`, que quedaría atado al límite chico de imagen) pero
// mismo patrón exacto: memoria, fileFilter por MIME permitido.
const uploadVideoMulter = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_VIDEO_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_VIDEO_MIME_TYPES.has(file.mimetype)) {
            return cb(new Error("INVALID_FILE_TYPE"));
        }
        cb(null, true);
    },
});

function handleVideoUpload(req, res, next) {
    uploadVideoMulter.single("file")(req, res, (error) => {
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: "El video no puede superar los 100 MB" });
        }
        if (error?.message === "INVALID_FILE_TYPE") {
            return res
                .status(400)
                .json({ message: "Formato no soportado. Usá MP4, MOV o WEBM" });
        }
        if (error) {
            return res.status(400).json({ message: "No se pudo procesar el video" });
        }
        next();
    });
}

const router = Router();

router.post("/upload", requireAuth, handleUpload, uploadImage);
router.post("/upload-video", requireAuth, handleVideoUpload, uploadVideo);
// `?type=video` — mismo endpoint de borrado que ya usaban las imágenes
// (deleteImage originalmente), ahora deleteMedia despacha por resource_type
// según ese query param. Default "image" preserva EXACTO el comportamiento
// de siempre para cualquier caller existente (ImageUploader.jsx nunca manda
// este query param).
router.delete("/*publicId", requireAuth, deleteMedia);

export default router;
