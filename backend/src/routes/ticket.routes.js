import { Router } from "express";
import { listTicketsOrganizer } from "../controllers/ticket.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Sólo el panel de organizador ("Entradas"). El comprador no tiene panel ni
// endpoints autenticados: recibe sus entradas por email/PDF y las recupera
// por email+DNI+código (ver sale.routes.js, /recover*).
const router = Router();

router.get("/organizer", requireRole("ORGANIZER"), listTicketsOrganizer);

export default router;
