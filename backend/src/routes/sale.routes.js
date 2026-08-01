import { Router } from "express";
import {
    createSale,
    confirmSale,
    confirmSaleByBuyer,
    cancelSale,
    listSalesOrganizer,
    listSalesBuyer,
} from "../controllers/sale.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

router.post("/", requireAuth, createSale);
router.get("/mine", requireAuth, listSalesBuyer);
router.get("/", requireRole("ORGANIZER"), listSalesOrganizer);
// Confirm por parte del organizador (desde UI organizador / webhook)
router.post("/:id/confirm", requireRole("ORGANIZER"), confirmSale);

// Confirmación automática disparada por el comprador tras pago simulado.
// Requiere autenticación y sólo permite confirmar la venta si el caller
// es el `buyer` de la venta. Internamente delega a `confirmSaleService`
// para reusar la misma lógica transaccional y de generación de tickets.
router.post("/:id/confirm-by-buyer", requireAuth, confirmSaleByBuyer);
router.post("/:id/cancel", requireAuth, cancelSale);

export default router;
