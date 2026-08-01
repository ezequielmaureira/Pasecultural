import { Router } from "express";
import {
    createSale,
    confirmSale,
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
router.post("/:id/confirm", requireRole("ORGANIZER"), confirmSale);
router.post("/:id/cancel", requireAuth, cancelSale);

export default router;
