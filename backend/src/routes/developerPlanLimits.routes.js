import { Router } from "express";
import { getDeveloperPlanLimits, updateDeveloperPlanLimits } from "../controllers/developerPlanLimits.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Mismo prefijo "/api/developer" que el resto de los routers Developer —
// noveno router montado en paralelo (sin tocar ninguno de los otros).
// Premium — Fase 2A, Developer > Configuración: GET/PATCH
// /api/developer/plan-limits (límites GENERALES de FREE/PREMIUM — nunca
// por Organization individual). Sólo DEVELOPER — ni ORGANIZER, ni
// SCANNER, ni CUSTOMER pueden ver ni editar esto.
const router = Router();

router.get("/plan-limits", requireRole("DEVELOPER"), getDeveloperPlanLimits);
router.patch("/plan-limits/:plan", requireRole("DEVELOPER"), updateDeveloperPlanLimits);

export default router;
