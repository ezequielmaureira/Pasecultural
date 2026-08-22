import { Router } from "express";
import {
    requestWithdrawalOtp,
    resendWithdrawalOtp,
    verifyWithdrawalOtp,
    createWithdrawalRequest,
    dismissWithdrawalRequest,
    listWithdrawalRequests,
    updateWithdrawalRequestStatus,
    getWithdrawalRequestTickets,
    returnWithdrawalRequestTickets,
} from "../controllers/withdrawalRequest.controller.js";
import { requireRole } from "../middlewares/requireRole.js";
import { rateLimit } from "../middlewares/rateLimit.js";

// Botón de arrepentimiento — mismo criterio que /api/sales/recover*: estos
// son endpoints públicos "de adivinanza" (prueban conocer datos, no una
// sesión), así que un límite básico por IP evita que sean un espacio
// infinito de intentos. Ver el informe de entrega, sección "Rate limit /
// abuso" — mismos valores que ya usa sale.routes.js para el flujo
// equivalente de recuperación, no números nuevos inventados sin motivo.
const router = Router();

const otpRequestRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 8 });
const otpResendRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5 });
const otpVerifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
// Paso 3 (crear la solicitud) no es "de adivinanza" — ya pasó el OTP — pero
// igual se limita por separado, más generoso, para no dejarlo como un
// vector barato de abuso automatizado una vez que alguien conoce un token
// real (ej. reintentos en loop).
const createRequestRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

router.post("/otp", otpRequestRateLimit, requestWithdrawalOtp);
router.post("/otp/resend", otpResendRateLimit, resendWithdrawalOtp);
router.post("/otp/verify", otpVerifyRateLimit, verifyWithdrawalOtp);
router.post("/:token", createRequestRateLimit, createWithdrawalRequest);
// Cierre del ciclo — "Descartar solicitud". Mismo criterio de rate limit
// que crear la solicitud: ya pasó el OTP, no es "de adivinanza", pero se
// limita igual para no dejarlo como vector barato de abuso.
router.post("/:token/dismiss", createRequestRateLimit, dismissWithdrawalRequest);

// Panel Organizer/Developer — ver withdrawalRequest.service.js para el
// aislamiento fino por organización (nunca sólo este requireRole grueso).
router.get("/", requireRole("ORGANIZER", "DEVELOPER"), listWithdrawalRequests);
router.post("/:id/status", requireRole("ORGANIZER", "DEVELOPER"), updateWithdrawalRequestStatus);
// Cierre del ciclo — detalle de entradas + "Marcar entrada como devuelta".
router.get("/:id/tickets", requireRole("ORGANIZER", "DEVELOPER"), getWithdrawalRequestTickets);
router.post("/:id/return-tickets", requireRole("ORGANIZER", "DEVELOPER"), returnWithdrawalRequestTickets);

export default router;
