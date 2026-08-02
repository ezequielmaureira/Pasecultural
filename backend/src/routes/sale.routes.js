import { Router } from "express";
import {
    createSale,
    confirmSale,
    confirmSaleByBuyer,
    cancelSale,
    listSalesOrganizer,
    listSalesBuyer,
    getSaleStatus,
    resendSaleConfirmationEmail,
} from "../controllers/sale.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Sin requireAuth a propósito: el comprador nunca necesita sesión de Clerk
// para comprar (checkout invitado). El controller decide internamente si
// hay una cuenta real logueada o si resuelve un comprador invitado por
// email — ver sale.controller.js#createSale.
router.post("/", createSale);
router.get("/mine", requireAuth, listSalesBuyer);
router.get("/", requireRole("ORGANIZER"), listSalesOrganizer);
// Confirm por parte del organizador (desde UI organizador / webhook)
router.post("/:id/confirm", requireRole("ORGANIZER"), confirmSale);

// Confirmación disparada por el propio flujo de compra (pago manual/
// simulado hoy, webhook de Mercado Pago mañana) — sin sesión, autorizado
// únicamente por conocer publicRecoveryToken (nunca el id interno). Ver
// sale.controller.js#confirmSaleByBuyer.
router.post("/:token/confirm-by-buyer", confirmSaleByBuyer);

// Público, sin sesión: sólo status por publicRecoveryToken, para la
// recuperación por timeout del Wizard invitado (no puede usar GET
// /sales/mine sin cuenta).
router.get("/:token/status", getSaleStatus);

router.post("/:id/cancel", requireAuth, cancelSale);

// Reintento administrativo del email de confirmación. requireRole acá es
// sólo el filtro grueso (excluye CUSTOMER/SCANNER de entrada); la
// verificación fina de "es DEVELOPER, o es el ORGANIZER dueño de ESTE
// evento puntual" vive en resendSaleConfirmationEmailService — mismo
// patrón que ya usa confirmSaleService con la organización.
router.post("/:id/resend-confirmation-email", requireRole("DEVELOPER", "ORGANIZER"), resendSaleConfirmationEmail);

export default router;
