import { Router } from "express";
import { handleMercadoPagoOAuthCallback } from "../controllers/mercadoPagoOAuthCallback.controller.js";

// MP-1 — router propio y público (mismo criterio que whatsapp.routes.js
// para el webhook de Meta): el callback de OAuth lo llama el navegador del
// organizador redirigido POR Mercado Pago, nunca nuestro propio frontend
// vía fetch/Bearer token, así que no puede vivir detrás de requireRole.
const router = Router();

router.get("/oauth/callback", handleMercadoPagoOAuthCallback);

export default router;
