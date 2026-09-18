import { Router } from "express";
import { getFestPassIntroContent, updateFestPassIntroContent } from "../controllers/content.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Developer > Contenido (V1 mínima) — mismo prefijo "/api/developer" que
// el resto de los routers Developer (sin tocar ninguno de esos archivos).
// Sólo DEVELOPER puede leer/escribir esta configuración.
const router = Router();

router.get("/content/fest-pass-intro", requireRole("DEVELOPER"), getFestPassIntroContent);
router.put("/content/fest-pass-intro", requireRole("DEVELOPER"), updateFestPassIntroContent);

export default router;
