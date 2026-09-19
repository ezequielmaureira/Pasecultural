import { Router } from "express";
import {
    getFestPassIntroContent,
    updateFestPassIntroContent,
    getHowItWorksContent,
    updateHowItWorksContent,
} from "../controllers/content.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Developer > Contenido (V1 mínima) — mismo prefijo "/api/developer" que
// el resto de los routers Developer (sin tocar ninguno de esos archivos).
// Sólo DEVELOPER puede leer/escribir esta configuración.
const router = Router();

router.get("/content/fest-pass-intro", requireRole("DEVELOPER"), getFestPassIntroContent);
router.put("/content/fest-pass-intro", requireRole("DEVELOPER"), updateFestPassIntroContent);

router.get("/content/how-it-works", requireRole("DEVELOPER"), getHowItWorksContent);
router.put("/content/how-it-works", requireRole("DEVELOPER"), updateHowItWorksContent);

export default router;
