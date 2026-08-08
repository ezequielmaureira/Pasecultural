import { Router } from "express";
import { getDeveloperDashboard } from "../controllers/developerDashboard.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// GET /api/developer/dashboard — único endpoint de este módulo, exclusivo
// DEVELOPER. No confundir con /api/dev (devTools.routes.js): ese es un
// panel de herramientas de desarrollo (reset/seed), con protección
// explícitamente temporal; este es el panel de control real de la
// plataforma.
router.get("/dashboard", requireRole("DEVELOPER"), getDeveloperDashboard);

export default router;
