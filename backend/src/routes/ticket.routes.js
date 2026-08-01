import { Router } from "express";
import { listMyTickets, getTicket, getTicketQr, getTicketByNumber } from "../controllers/ticket.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

router.get("/mine", requireAuth, listMyTickets);
router.get("/number/:ticketNumber", requireAuth, getTicketByNumber);
router.get("/:id/qr", requireAuth, getTicketQr);
router.get("/:id", requireAuth, getTicket);

export default router;
