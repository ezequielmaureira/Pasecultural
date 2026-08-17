import { Router } from "express";
import { handleMercadoPagoOAuthCallback } from "../controllers/mercadoPagoOAuthCallback.controller.js";
import { handleMercadoPagoWebhook } from "../controllers/mercadoPagoWebhook.controller.js";

// MP-1 — router propio y público (mismo criterio que whatsapp.routes.js
// para el webhook de Meta): el callback de OAuth lo llama el navegador del
// organizador redirigido POR Mercado Pago, nunca nuestro propio frontend
// vía fetch/Bearer token, así que no puede vivir detrás de requireRole.
const router = Router();

router.get("/oauth/callback", handleMercadoPagoOAuthCallback);

// MP-3 — mismo criterio: Mercado Pago llama acá server-to-server, sin
// ninguna sesión de Clerk. Público no significa confiar en el body — ver
// mercadoPagoWebhook.controller.js para la validación de firma.
router.post("/webhook", handleMercadoPagoWebhook);

export default router;
