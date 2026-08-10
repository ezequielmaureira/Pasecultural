import { logger } from "../logging/logger.js";
import {
    evaluateWebhookVerification,
    getWhatsappVerifyToken,
    isWhatsappTestModeEnabled,
    normalizeWhatsappOutboundRecipient,
    parseInboundWhatsappMessages,
    sendWhatsappTextMessage,
    shouldAutoReply,
    AUTO_REPLY_TEXT,
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

// Responde UNA vez, con el mismo texto fijo, a un único mensaje ya
// normalizado — Fase 2D. `sendText` es inyectable únicamente para tests
// (nunca se le pasa nada distinto desde receiveWhatsappWebhook/Express, que
// llama esta función sin segundo argumento): permite probar la lógica de
// "a quién y con qué contestamos" sin mockear fetch/red.
// Nunca deja escapar una excepción — ni un rechazo de Meta (success:false)
// ni un error de red/timeout pueden convertir el webhook en 500, porque
// Meta reintentaría el mismo mensaje entrante y empeoraría el problema.
export async function processInboundMessage(message, { sendText = sendWhatsappTextMessage } = {}) {
    if (!shouldAutoReply(message)) return;

    // Sólo transforma el destinatario cuando WHATSAPP_TEST_MODE=true (ver
    // normalizeWhatsappOutboundRecipient) — en producción normal, sin esa
    // variable configurada, `to` sigue siendo exactamente message.from.
    const to = normalizeWhatsappOutboundRecipient(message.from, isWhatsappTestModeEnabled());

    try {
        const result = await sendText({ to, text: AUTO_REPLY_TEXT });
        if (!result.success) {
            // Nunca el texto/teléfono completo/token — sólo lo necesario
            // para diagnosticar en desarrollo.
            logger.warn("WhatsApp auto-reply: Meta rechazó el envío", {
                inboundMessageId: message.messageId,
                success: false,
                error: result.error,
                recipientNormalized: to !== message.from,
            });
            return;
        }
        logger.info("WhatsApp auto-reply sent", {
            inboundMessageId: message.messageId,
            success: true,
            outboundMessageId: result.messageId,
            recipientNormalized: to !== message.from,
        });
    } catch (error) {
        logger.error(error, { context: "whatsapp auto-reply", inboundMessageId: message.messageId });
    }
}

// Orquesta el reply de TODOS los mensajes de un mismo POST — separada de
// receiveWhatsappWebhook para poder testearla con un `sendText` mockeado
// sin pasar por Express (que ya inyecta su propio tercer argumento, `next`,
// así que receiveWhatsappWebhook no puede tener un parámetro de DI propio).
// Promise.allSettled: un mensaje cuyo intento de respuesta falle nunca
// bloquea ni afecta a los demás.
export async function processInboundMessages(messages, deps) {
    await Promise.allSettled(messages.map((message) => processInboundMessage(message, deps)));
}

// POST /api/whatsapp/webhook — Fase 2B reconoce mensajes entrantes de forma
// segura; Fase 2D agrega la respuesta automática mínima. A propósito sigue
// sin llamar a EventCreationEngine/EventServicePort ni escribir en la base.
// Los webhooks de status (sent/delivered/read/failed) no tienen
// `value.messages`, así que parseInboundWhatsappMessages ya los ignora
// limpiamente (devuelve []) sin necesidad de distinguirlos acá — nunca se
// les responde nada.
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

    // Fire-and-forget A PROPÓSITO: Meta necesita el 200 YA, no recién
    // después de esperar hasta GRAPH_API_TIMEOUT_MS a que termine (o
    // falle) el intento de responder. processInboundMessage ya nunca
    // lanza (ver su propio comentario), así que no hace falta un .catch()
    // adicional acá — sólo se dispara, nunca se espera.
    void processInboundMessages(messages);

    res.sendStatus(200);
};
