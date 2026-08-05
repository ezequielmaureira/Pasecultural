import { Router } from "express";
import {
    requestScannerLoginCode,
    resendScannerLoginCode,
    verifyScannerLoginCode,
} from "../controllers/scannerAuth.controller.js";
import { rateLimit } from "../middlewares/rateLimit.js";

const router = Router();

// Portal Scanner — sin requireAuth en ninguna ruta, mismo criterio que
// scannerInvitation.routes.js (el login por email + código de 6 dígitos es
// la única credencial). Mismas magnitudes de rate limit que esas rutas —
// el límite real contra fuerza bruta del código es el de intentos por fila
// (MAX_VERIFICATION_ATTEMPTS, en scannerLogin.service.js), esto es sólo una
// segunda capa contra abuso por IP.
const requestRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });
const resendRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5 });
const verifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/request-code", requestRateLimit, requestScannerLoginCode);
router.post("/resend-code", resendRateLimit, resendScannerLoginCode);
router.post("/verify", verifyRateLimit, verifyScannerLoginCode);

export default router;
