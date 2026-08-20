import { Router } from "express";
import { handleMercadoPagoOAuthCallback } from "../controllers/mercadoPagoOAuthCallback.controller.js";
import { handleMercadoPagoWebhook } from "../controllers/mercadoPagoWebhook.controller.js";
import { rateLimit } from "../middlewares/rateLimit.js";

// MP-1 — router propio y público (mismo criterio que whatsapp.routes.js
// para el webhook de Meta): el callback de OAuth lo llama el navegador del
// organizador redirigido POR Mercado Pago, nunca nuestro propio frontend
// vía fetch/Bearer token, así que no puede vivir detrás de requireRole.
const router = Router();

router.get("/oauth/callback", handleMercadoPagoOAuthCallback);

// Auditoría "endurecer webhook" — defensa de recursos, NUNCA de
// autenticación: la firma HMAC (mercadoPagoWebhookSignature.js) sigue
// siendo la única protección real. Reusa el mismo rateLimit() en memoria
// que ya usan sale.routes.js/scannerAuth.routes.js (sin dependencia
// nueva), pero con un límite deliberadamente generoso — a diferencia de
// esos endpoints (humanos, 5-20 intentos/10-15min), Mercado Pago es una
// integración server-to-server que puede mandar ráfagas legítimas
// (varias compras simultáneas, reintentos, refunds/chargebacks) y NUNCA
// debe verse frenada por esto. 180 requests/minuto por IP (req.ip ya
// refleja la IP real gracias a `trust proxy`, ver app.js) alcanza y sobra
// para cualquier volumen realista de PaseCultural, y sigue frenando una
// ráfaga de scanning/abuso sostenida contra un endpoint público. Sobre el
// límite: 429 (mismo criterio que el resto de rateLimit.js) — Mercado
// Pago lo trata como cualquier respuesta no-200/201 y reintenta más
// tarde, comportamiento aceptado, nunca un 500 que sugiera un error
// propio.
const webhookRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    message: "Too many requests.",
});

// MP-3 — mismo criterio: Mercado Pago llama acá server-to-server, sin
// ninguna sesión de Clerk. Público no significa confiar en el body — ver
// mercadoPagoWebhook.controller.js para la validación de firma.
router.post("/webhook", webhookRateLimit, handleMercadoPagoWebhook);

export default router;
