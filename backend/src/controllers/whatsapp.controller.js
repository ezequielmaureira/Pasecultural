import { logger } from "../logging/logger.js";
import {
    evaluateWebhookVerification,
    getWhatsappVerifyToken,
    parseInboundWhatsappMessages,
} from "../services/whatsapp.service.js";

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

// POST /api/whatsapp/webhook — Fase 2B: reconoce mensajes entrantes de
// forma segura. A propósito NO llama a EventCreationEngine/EventServicePort,
// NO escribe en la base, NO llama APIs externas y NO le responde nada a
// WhatsApp — eso sigue siendo de una fase posterior. Los webhooks de status
// (sent/delivered/read/failed) no tienen `value.messages`, así que
// parseInboundWhatsappMessages ya los ignora limpiamente (devuelve []) sin
// necesidad de distinguirlos acá.
export const receiveWhatsappWebhook = (req, res) => {
    const messages = parseInboundWhatsappMessages(req.body);

    // Nunca se loguea text.body, el nombre del contacto ni el teléfono
    // completo — sólo lo mínimo para confirmar en desarrollo que llegó un
    // mensaje real.
    for (const message of messages) {
        logger.info("WhatsApp inbound message", {
            messageId: message.messageId,
            type: message.type,
            phoneNumberId: message.phoneNumberId,
        });
    }

    res.sendStatus(200);
};
