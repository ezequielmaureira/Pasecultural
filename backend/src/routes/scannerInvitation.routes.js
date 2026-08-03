import { Router } from "express";
import {
    getScannerInvitation,
    registerScannerInvitation,
    resendScannerVerificationCode,
    verifyScannerInvitationCode,
} from "../controllers/scannerInvitation.controller.js";
import { rateLimit } from "../middlewares/rateLimit.js";

const router = Router();

// Sin requireAuth en NINGUNA de estas rutas a propósito: el registro y la
// verificación por código de 6 dígitos reemplazan por completo el paso de
// login con Clerk en este flujo (ver scannerInvitation.service.js). El
// límite real contra fuerza bruta del código en sí es el de intentos por
// fila (MAX_VERIFICATION_ATTEMPTS, en el service) — esto de acá es sólo
// una segunda capa contra abuso por IP.
const registerRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });
const verifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const resendRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5 });

router.get("/:token", getScannerInvitation);
router.post("/:token/register", registerRateLimit, registerScannerInvitation);
router.post("/:token/resend", resendRateLimit, resendScannerVerificationCode);
router.post("/:token/verify", verifyRateLimit, verifyScannerInvitationCode);

export default router;
