import { Router } from "express";
import {
    getServiceFeeConfig,
    updateServiceFeeConfig,
    getBuyerBenefitConfig,
    updateBuyerBenefitConfig,
} from "../controllers/developerServiceFee.controller.js";
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
// Beneficio inicial para compradores — duración en meses (0 = desactivado).
// Misma pantalla y mismo router que los rangos: las dos configuraciones
// comerciales del cargo de servicio viven juntas.
router.get("/service-fee/buyer-benefit", requireRole("DEVELOPER"), getBuyerBenefitConfig);
router.put("/service-fee/buyer-benefit", requireRole("DEVELOPER"), updateBuyerBenefitConfig);

export default router;
