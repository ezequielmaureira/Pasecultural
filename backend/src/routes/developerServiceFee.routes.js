import { Router } from "express";
import { getServiceFeeConfig, updateServiceFeeConfig } from "../controllers/developerServiceFee.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Mismo prefijo "/api/developer" que developerDashboard/developerEvents/
// developerTickets/developerScanners/developerSales.routes.js — sexto
// router montado en paralelo (sin tocar ninguno de esos archivos). MP-6 —
// Developer > Configuración: GET/PUT /api/developer/service-fee. Sólo
// DEVELOPER (comprador nunca puede leer/elegir nada de esto — el checkout
// público lee la configuración server-side, nunca recibe el importe de
// comisión que el frontend "cree" que corresponde).
const router = Router();

router.get("/service-fee", requireRole("DEVELOPER"), getServiceFeeConfig);
router.put("/service-fee", requireRole("DEVELOPER"), updateServiceFeeConfig);

export default router;
