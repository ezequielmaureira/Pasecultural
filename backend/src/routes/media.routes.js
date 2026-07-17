import { Router } from "express";
import multer from "multer";
import { uploadImage, deleteImage } from "../controllers/media.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
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
