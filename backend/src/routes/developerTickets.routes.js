import { Router } from "express";
import {
    listDeveloperTickets,
    getDeveloperTicket,
    getDeveloperEventOptions,
} from "../controllers/developerTickets.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Montado en "/api/developer" (ver app.js, junto a developerDashboard.routes.js
// y developerEvents.routes.js, que ya usan el mismo prefijo) — resultado final:
// GET /api/developer/tickets
// GET /api/developer/tickets/:id
// GET /api/developer/events/options
// Sólo lectura, exclusivo DEVELOPER, platform-wide a propósito.
//
// "/events/options" vive acá (no en developerEvents.routes.js) a propósito:
// existe únicamente para alimentar el filtro en cascada de esta pantalla,
// y developerEvents.routes.js queda fuera de alcance para modificar.
router.get("/tickets", requireRole("DEVELOPER"), listDeveloperTickets);
router.get("/tickets/:id", requireRole("DEVELOPER"), getDeveloperTicket);
router.get("/events/options", requireRole("DEVELOPER"), getDeveloperEventOptions);

export default router;
