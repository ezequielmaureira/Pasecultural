import { Router } from "express";
import {
    listDeveloperEvents,
    getDeveloperOrganizationOptions,
} from "../controllers/developerEvents.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Montado en "/api/developer" (ver app.js, junto a developerDashboard.routes.js
// que ya usa el mismo prefijo para "/dashboard") — resultado final:
// GET /api/developer/events
// GET /api/developer/organizations/options
// Sólo lectura, exclusivo DEVELOPER, platform-wide a propósito.
router.get("/events", requireRole("DEVELOPER"), listDeveloperEvents);
router.get("/organizations/options", requireRole("DEVELOPER"), getDeveloperOrganizationOptions);

export default router;
