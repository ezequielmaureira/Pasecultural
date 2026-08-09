import { Router } from "express";
import { listDeveloperScanners, getDeveloperScanner } from "../controllers/developerScanners.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Montado en "/api/developer" (ver app.js, junto a developerDashboard/
// developerEvents/developerTickets, que ya usan el mismo prefijo) —
// resultado final:
// GET /api/developer/scanners
// GET /api/developer/scanners/:id
// Sólo lectura, exclusivo DEVELOPER, platform-wide a propósito. No
// reutiliza organizations/options ni events/options (siguen viviendo en
// developerEvents.routes.js/developerTickets.routes.js, sin tocarlos).
router.get("/scanners", requireRole("DEVELOPER"), listDeveloperScanners);
router.get("/scanners/:id", requireRole("DEVELOPER"), getDeveloperScanner);

export default router;
