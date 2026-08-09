import { Router } from "express";
import { verifyWhatsappWebhook, receiveWhatsappWebhook } from "../controllers/whatsapp.controller.js";

const router = Router();

// Público a propósito, sin requireAuth/requireRole: Meta llama a este
// endpoint directamente (verificación GET y eventos POST), sin ningún
// header de sesión de PaseCultural. La autorización real de la
// verificación es hub.verify_token (ver whatsapp.controller.js); el POST
// en esta fase sólo confirma recepción, sin tocar ningún dato de la
// plataforma.
router.get("/webhook", verifyWhatsappWebhook);
router.post("/webhook", receiveWhatsappWebhook);

export default router;
