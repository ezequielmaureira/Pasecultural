import { Router } from "express";
import { getDeveloperAlertConfig, updateDeveloperAlertConfig } from "../controllers/developerAlertConfig.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Mismo prefijo "/api/developer" que el resto de los routers Developer —
// séptimo router montado en paralelo (sin tocar ninguno de los otros).
// Alertas Developer — Developer > Configuración: GET/PUT
// /api/developer/alert-config (umbrales de las alertas de patrón/volumen).
// Sólo DEVELOPER — ni ORGANIZER, ni SCANNER, ni CUSTOMER pueden ver ni
// editar esto.
const router = Router();

router.get("/alert-config", requireRole("DEVELOPER"), getDeveloperAlertConfig);
router.put("/alert-config", requireRole("DEVELOPER"), updateDeveloperAlertConfig);

export default router;
