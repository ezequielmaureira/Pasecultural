import { logger } from "../logging/logger.js";
import { evaluateWebhookVerification, getWhatsappVerifyToken } from "../services/whatsapp.service.js";

// GET /api/whatsapp/webhook — mecanismo oficial de verificación de Meta
// ("Paso 2. Configuración de producción" del panel de WhatsApp Cloud API).
// Meta manda hub.mode/hub.verify_token/hub.challenge como query params;
// nunca se loguea el token recibido ni el esperado, sólo el resultado.
export const verifyWhatsappWebhook = (req, res) => {
    let expectedToken;
    try {
        expectedToken = getWhatsappVerifyToken();
    } catch (error) {
        logger.error(error, { context: "whatsapp webhook verify" });
        return res.sendStatus(500);
    }

    const result = evaluateWebhookVerification(
        {
            mode: req.query["hub.mode"],
            token: req.query["hub.verify_token"],
            challenge: req.query["hub.challenge"],
        },
        expectedToken
    );

    if (!result.verified) {
        logger.info("whatsapp webhook: verificación rechazada", { mode: req.query["hub.mode"] });
        return res.sendStatus(403);
    }

    // Meta exige el body EXACTO de hub.challenge, sin envolver en JSON.
    res.status(200).send(result.challenge);
};

// POST /api/whatsapp/webhook — Fase 2A: sólo confirmar que Meta llega al
// backend. A propósito NO procesa el payload, NO llama a
// EventCreationEngine/EventServicePort, NO escribe en la base y NO le
// responde nada a WhatsApp — eso es de una fase posterior. Se loguea sólo
// forma/tamaño del payload, nunca su contenido (puede incluir datos de
// contacto del remitente).
export const receiveWhatsappWebhook = (req, res) => {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    logger.info("whatsapp webhook: POST recibido", { object: req.body?.object, entryCount: entries.length });

    res.sendStatus(200);
};
