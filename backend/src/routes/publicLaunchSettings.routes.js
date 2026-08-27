import { Router } from "express";
import { getDeveloperLaunchStatus, updateDeveloperLaunchStatus } from "../controllers/publicLaunchSettings.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Mismo prefijo "/api/developer" que el resto de los routers Developer —
// octavo router montado en paralelo (sin tocar ninguno de los otros).
// Modo Prelanzamiento — Developer > Configuración: GET/PUT
// /api/developer/launch-status (estado público de PaseCultural). Sólo
// DEVELOPER — ni ORGANIZER, ni SCANNER, ni CUSTOMER pueden ver ni editar
// esto.
const router = Router();

router.get("/launch-status", requireRole("DEVELOPER"), getDeveloperLaunchStatus);
router.put("/launch-status", requireRole("DEVELOPER"), updateDeveloperLaunchStatus);

export default router;
