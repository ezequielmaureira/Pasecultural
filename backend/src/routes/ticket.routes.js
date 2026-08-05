import { Router } from "express";
import { listMyTickets, getTicket, getTicketQr, getTicketByNumber, listTicketsOrganizer } from "../controllers/ticket.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

router.get("/mine", requireAuth, listMyTickets);
router.get("/number/:ticketNumber", requireAuth, getTicketByNumber);
// Antes de "/:id" a propósito — si no, Express lo capturaría como si "organizer" fuera un id de ticket.
router.get("/organizer", requireRole("ORGANIZER"), listTicketsOrganizer);
router.get("/:id/qr", requireAuth, getTicketQr);
router.get("/:id", requireAuth, getTicket);

export default router;
