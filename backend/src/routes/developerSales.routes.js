import { Router } from "express";
import { listDeveloperSales, getDeveloperSale, getMercadoPagoSaleDiagnostics } from "../controllers/developerSales.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Montado en "/api/developer" (ver app.js, junto a developerDashboard/
// developerEvents/developerTickets/developerScanners, que ya usan el mismo
// prefijo) — resultado final:
// GET /api/developer/sales
// GET /api/developer/sales/:id
// GET /api/developer/sales/:id/mercadopago-diagnostics
// Sólo lectura, exclusivo DEVELOPER, platform-wide a propósito.
router.get("/sales", requireRole("DEVELOPER"), listDeveloperSales);
router.get("/sales/:id", requireRole("DEVELOPER"), getDeveloperSale);
// Diagnóstico de Mercado Pago para una Sale puntual — nunca público, nunca
// muta nada (ver getMercadoPagoSaleDiagnosticsService).
router.get("/sales/:id/mercadopago-diagnostics", requireRole("DEVELOPER"), getMercadoPagoSaleDiagnostics);

export default router;
