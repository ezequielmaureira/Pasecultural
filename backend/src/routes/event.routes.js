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
} from "../controllers/event.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// Marketplace público (sin autenticación) — deben declararse antes de "/:id"
router.get("/public", getPublicEvents);
router.get("/public/:slug", getPublicEventBySlug);

router.post("/", requireAuth, createEvent);
router.get("/mine", requireAuth, getMyEvents);
router.get("/:id", requireAuth, getMyEventById);
router.patch("/:id", requireAuth, updateMyEvent);
router.put("/:id/schedule", requireAuth, saveEventSchedule);
router.put("/:id/links", requireAuth, saveEventLinks);
router.delete("/:id", requireAuth, deleteMyEvent);

export default router;
