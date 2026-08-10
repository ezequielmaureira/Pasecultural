import { Router } from "express";
import multer from "multer";
import { uploadImage, deleteImage } from "../controllers/media.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_FILE_SIZE } from "../services/media.service.js";

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

const router = Router();

router.post("/upload", requireAuth, handleUpload, uploadImage);
router.delete("/*publicId", requireAuth, deleteImage);

export default router;
