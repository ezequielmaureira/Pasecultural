import { Router } from "express";
import {
    issueCourtesy,
    listCourtesies,
    getCourtesyStats,
    resendCourtesyEmail,
    getCourtesyPdf,
    cancelCourtesy,
} from "../controllers/courtesy.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Todo el módulo Cortesías es exclusivo de ORGANIZER/DEVELOPER — pedido
// explícito de seguridad. La verificación fina (¿es DUEÑO de esta
// organización puntual, o es DEVELOPER?) vive en courtesy.service.js, mismo
// patrón que ya usa /sales/:id/resend-confirmation-email.
router.use(requireRole("ORGANIZER", "DEVELOPER"));

router.post("/", issueCourtesy);
router.get("/", listCourtesies);
router.get("/stats", getCourtesyStats);
router.post("/:saleId/resend-email", resendCourtesyEmail);
router.get("/:saleId/pdf", getCourtesyPdf);
router.post("/:saleId/cancel", cancelCourtesy);

export default router;
