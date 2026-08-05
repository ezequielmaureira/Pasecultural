import { Router } from "express";
import {
    createEvent,
    getMyEvents,
    getMyEventById,
    updateMyEvent,
    deleteMyEvent,
    getPublicEvents,
    getPublicEventBySlug,
    saveEventSchedule,
    saveEventLinks,
    getEventCategories,
} from "../controllers/event.controller.js";
import {
    listActiveEventsForScanner,
    listEventScanners,
    createScannerInvitations,
    updateScanner,
    disableScanner,
    reactivateScanner,
    deleteScanner,
    revokeScannerInvitation,
    regenerateScannerInvitation,
} from "../controllers/eventScanner.controller.js";
import {
    cancelTicket,
    rehabilitateTicket,
    reactivateUsedTicket,
    markTicketUsedManually,
    softDeleteTicket,
    bulkActionTickets,
} from "../controllers/ticketAdmin.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// Marketplace público (sin autenticación) — deben declararse antes de "/:id"
router.get("/public", getPublicEvents);
router.get("/public/:slug", getPublicEventBySlug);
router.get("/categories", getEventCategories);
// Paso 1 del asistente de scanners ("¿para qué evento?") — sin eventId
// propio, así que también tiene que ir antes de "/:id" para no confundirse
// con un id de evento literal.
router.get("/scanner-events", requireAuth, listActiveEventsForScanner);

router.post("/", requireAuth, createEvent);
router.get("/mine", requireAuth, getMyEvents);
router.get("/:id", requireAuth, getMyEventById);
router.patch("/:id", requireAuth, updateMyEvent);
router.put("/:id/schedule", requireAuth, saveEventSchedule);
router.put("/:id/links", requireAuth, saveEventLinks);

router.get("/:id/scanners", requireAuth, listEventScanners);
// Paso 4 del asistente: crea `quantity` invitaciones para una puerta.
router.post("/:id/scanners", requireAuth, createScannerInvitations);
router.patch("/:id/scanners/:scannerId", requireAuth, updateScanner);
router.post("/:id/scanners/:scannerId/disable", requireAuth, disableScanner);
router.post("/:id/scanners/:scannerId/reactivate", requireAuth, reactivateScanner);
router.post("/:id/scanners/:scannerId/revoke", requireAuth, revokeScannerInvitation);
router.post("/:id/scanners/:scannerId/regenerate", requireAuth, regenerateScannerInvitation);
router.delete("/:id/scanners/:scannerId", requireAuth, deleteScanner);

// Administración de entradas del organizador — ver ticketAdmin.service.js.
// Sin UI todavía (a propósito, ver auditoría del modelo de datos): quedan
// disponibles para cuando se construya el panel de administración.
router.post("/:id/tickets/bulk-action", requireAuth, bulkActionTickets);
router.post("/:id/tickets/:ticketId/cancel", requireAuth, cancelTicket);
router.post("/:id/tickets/:ticketId/rehabilitate", requireAuth, rehabilitateTicket);
router.post("/:id/tickets/:ticketId/reactivate", requireAuth, reactivateUsedTicket);
router.post("/:id/tickets/:ticketId/mark-used", requireAuth, markTicketUsedManually);
router.delete("/:id/tickets/:ticketId", requireAuth, softDeleteTicket);

router.delete("/:id", requireAuth, deleteMyEvent);

export default router;
