import { Router } from "express";
import {
    getOrganizerNotificationSettings,
    updateOrganizerNotificationSettings,
} from "../controllers/organizerNotificationSettings.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Dashboard Organizador > Configuración > Notificaciones — GET/PUT
// /api/organizer/notification-settings. Sólo ORGANIZER: es una preferencia
// de SU organización, sin ninguna vista platform-wide equivalente para
// DEVELOPER (a diferencia de /api/withdrawal-requests, que sí expone una
// vista global).
const router = Router();

router.get("/notification-settings", requireRole("ORGANIZER"), getOrganizerNotificationSettings);
router.put("/notification-settings", requireRole("ORGANIZER"), updateOrganizerNotificationSettings);

export default router;
