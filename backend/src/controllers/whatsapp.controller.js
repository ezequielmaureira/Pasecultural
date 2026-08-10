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
import * as EventCreationEngine from "../conversation/EventCreationEngine.js";
import { resolveWhatsappOrganizerIdentity } from "../services/whatsappOrganizerIdentity.service.js";
import { createOrReuseWhatsappLinkChallenge } from "../services/whatsappOrganizerLink.service.js";
import {
    classifyInitialIntent,
    isCancelCommand,
    extractWhatsappReplyText,
    buildWhatsappLinkChallengeText,
    WHATSAPP_DECLINE_TEXT,
    WHATSAPP_CANCEL_TEXT,
    WHATSAPP_LINK_CHALLENGE_PENDING_TEXT,
} from "../services/whatsappOrganizerBot.service.js";

// El valor real de ConversationChannel para este canal (ver
// prisma/schema.prisma `enum ConversationChannel { WEB WHATSAPP }`, ya usado
// tal cual por conversation.controller.js para "WEB") — no se inventa un
// literal nuevo.
const WHATSAPP_CHANNEL = "WHATSAPP";

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

// Centraliza el envío + log de éxito/fracaso de CUALQUIER respuesta del bot
// (saludo, negativa, pregunta del motor, cancelación, etc.) — antes había un
// único punto de envío (Fase 2D); ahora hay varias ramas y todas necesitan
// exactamente el mismo chequeo de result.success, así que vive acá una sola
// vez en vez de repetirse en cada rama de processInboundMessage.
async function sendBotReply({ sendText, to, from, messageId, text, engineAction }) {
    if (!text) return;
    const result = await sendText({ to, text });
    const recipientNormalized = to !== from;
    if (!result.success) {
        // Nunca el texto/teléfono completo/token — sólo lo necesario para
        // diagnosticar en desarrollo (ver sección 12 del pedido de Fase 2E).
        logger.warn("WhatsApp organizer bot: Meta rechazó el envío", {
            inboundMessageId: messageId,
            engineAction,
            success: false,
            error: result.error,
            recipientNormalized,
        });
        return;
    }
    logger.info("WhatsApp organizer bot reply sent", {
        inboundMessageId: messageId,
        engineAction,
        success: true,
        outboundMessageId: result.messageId,
        recipientNormalized,
    });
}

// Único punto que conecta WhatsApp con EventCreationEngine — Fase 2E.
// WhatsApp es sólo OTRO CANAL: nunca reimplementa pasos/preguntas propias,
// sólo decide (a) si hay que iniciar el motor o no, y (b) reenvía lo que el
// motor ya haya decidido. Todas las dependencias reales son inyectables
// (mismo criterio que `sendText` desde Fase 2D) para poder testear la
// orquestación sin tocar Prisma/red.
//
// IMPORTANTE — identidad: resolveOrganizerIdentity sólo resuelve contra un
// WhatsappOrganizerLink YA VERIFICADO (Fase 2F) — nunca contra
// Organization.phone ni ninguna otra fuente sin verificar. Mientras un
// wa_id no tenga vínculo, EventCreationEngine.start NUNCA se llama con una
// identidad inventada: en su lugar se dispara un challenge de vinculación
// (createOrReuseWhatsappLinkChallenge) para que el organizador lo confirme
// desde su panel autenticado con Clerk.
//
// Nunca deja escapar una excepción — ni un rechazo de Meta ni un error del
// motor pueden convertir el webhook en 500 (Meta reintentaría el mismo
// mensaje entrante y empeoraría el problema).
export async function processInboundMessage(
    message,
    {
        sendText = sendWhatsappTextMessage,
        startConversation = EventCreationEngine.start,
        handleConversationInput = EventCreationEngine.handleInput,
        cancelConversation = EventCreationEngine.cancel,
        findActiveConversation = EventCreationEngine.findActiveConversation,
        resolveOrganizerIdentity = resolveWhatsappOrganizerIdentity,
        createLinkChallenge = createOrReuseWhatsappLinkChallenge,
    } = {}
) {
    if (!shouldAutoReply(message)) return;

    // channelRef identifica la conversación de forma estable por el wa_id
    // de origen — SIEMPRE el número tal cual lo manda Meta (message.from),
    // nunca el normalizado de WHATSAPP_TEST_MODE: esa normalización es sólo
    // para el campo `to` del envío saliente (ver whatsapp.service.js Fase
    // 2D.1), no para identificar quién es quién.
    const channelRef = message.from;
    const to = normalizeWhatsappOutboundRecipient(message.from, isWhatsappTestModeEnabled());
    const text = message.text.trim();
    const reply = (replyText, engineAction) =>
        sendBotReply({ sendText, to, from: message.from, messageId: message.messageId, text: replyText, engineAction });

    try {
        const active = await findActiveConversation({ channel: WHATSAPP_CHANNEL, channelRef });

        if (active) {
            if (isCancelCommand(text)) {
                await cancelConversation(active.id, active.userId);
                await reply(WHATSAPP_CANCEL_TEXT, "CANCEL");
                return;
            }

            const result = await handleConversationInput(active.id, { value: text });
            await reply(extractWhatsappReplyText(result), "HANDLE_INPUT");
            return;
        }

        const intent = classifyInitialIntent(text);

        if (intent === "NEGATIVE") {
            await reply(WHATSAPP_DECLINE_TEXT, "DECLINE");
            return;
        }

        if (intent !== "AFFIRMATIVE") {
            await reply(AUTO_REPLY_TEXT, "PROMPT");
            return;
        }

        const identity = await resolveOrganizerIdentity(channelRef);
        if (!identity) {
            // Sin vínculo verificado todavía (Fase 2F) — se dispara/reusa un
            // challenge en vez de inventar una identidad. challengeCreated
            // es el único dato del challenge que se loguea (nunca el
            // código, ni el hash, ni el wa_id completo).
            const challengeResult = await createLinkChallenge(channelRef);
            logger.info("WhatsApp organizer bot: sin vínculo verificado", {
                inboundMessageId: message.messageId,
                engineAction: "LINK_CHALLENGE",
                challengeCreated: Boolean(challengeResult?.code),
            });
            await reply(
                challengeResult?.code ? buildWhatsappLinkChallengeText(challengeResult.code) : WHATSAPP_LINK_CHALLENGE_PENDING_TEXT,
                "LINK_CHALLENGE"
            );
            return;
        }

        const startResult = await startConversation({ clerkId: identity.clerkId, channel: WHATSAPP_CHANNEL, channelRef });
        await reply(extractWhatsappReplyText(startResult), "START");
    } catch (error) {
        logger.error(error, { context: "whatsapp organizer bot", inboundMessageId: message.messageId });
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
// segura; Fase 2D agrega la respuesta automática mínima; Fase 2E conecta
// processInboundMessage con EventCreationEngine (ver más arriba) — este
// controller sigue sin conocer Prisma ni los pasos del motor directamente,
// eso vive en processInboundMessage/EventCreationEngine.
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
