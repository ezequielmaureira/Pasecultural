import { Router } from "express";
import { listDeveloperSales, getDeveloperSale } from "../controllers/developerSales.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Montado en "/api/developer" (ver app.js, junto a developerDashboard/
// developerEvents/developerTickets/developerScanners, que ya usan el mismo
// prefijo) — resultado final:
// GET /api/developer/sales
// GET /api/developer/sales/:id
// Sólo lectura, exclusivo DEVELOPER, platform-wide a propósito.
router.get("/sales", requireRole("DEVELOPER"), listDeveloperSales);
router.get("/sales/:id", requireRole("DEVELOPER"), getDeveloperSale);

export default router;
