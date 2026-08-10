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
// Fase 2F, legacy — whatsappOrganizerIdentity.service.js/
// createOrReuseWhatsappLinkChallenge ya no se importan acá: el flujo de
// código de 6 dígitos dejó de ofrecerse desde WhatsApp Organizer (ver
// informe de entrega Fase 2G). Los archivos siguen existiendo tal cual,
// sin uso.
import {
    discoverWhatsappOrganizationCandidates,
    getPendingOrganizationSelection,
    createPendingOrganizationSelection,
    resolveOrganizationSelectionChoice,
    confirmOrganizationSelection,
    clearPendingOrganizationSelection,
    resolveOrganizationOwner,
} from "../services/whatsappOrganizerDiscovery.service.js";
import {
    classifyInitialIntent,
    isCancelCommand,
    extractWhatsappReplyText,
    resolveSingleSelectIndexReply,
    WHATSAPP_DECLINE_TEXT,
    WHATSAPP_CANCEL_TEXT,
    WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT,
    WHATSAPP_SELECTION_INVALID_TEXT,
    WHATSAPP_IMAGE_NOT_EXPECTED_TEXT,
    buildKnownOrganizationGreetingText,
    buildOrganizationSelectorText,
    buildOrganizationSelectedConfirmationText,
    buildOrganizationSelectionConfirmationRetryText,
    buildWhatsappImageUploadErrorText,
} from "../services/whatsappOrganizerBot.service.js";
import { uploadWhatsappImageMessage } from "../services/whatsappMediaUpload.service.js";

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
// IMPORTANTE — identidad (Fase 2G): la identificación ya NO depende de un
// código de 6 dígitos (Fase 2F, legacy). Se resuelve por coincidencia
// EXACTA de teléfono contra Organization.phone
// (discoverWhatsappOrganizationCandidates, que a su vez reusa vínculos
// WhatsappOrganizerLink ya existentes antes de volver a mirar teléfonos —
// ver ese archivo). 0 candidatos -> mensaje "no encontrado", nunca se
// inventa una identidad ni se dispara un challenge. 1 candidato -> saludo
// automático. Varios candidatos -> selector numerado explícito, con estado
// persistido en WhatsappPendingOrganizationSelection (nunca inferido de
// timestamps) hasta que el organizador elige y confirma.
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
        resumeConversation = EventCreationEngine.resume,
        discoverCandidates = discoverWhatsappOrganizationCandidates,
        getPendingSelection = getPendingOrganizationSelection,
        createPendingSelection = createPendingOrganizationSelection,
        confirmSelection = confirmOrganizationSelection,
        clearPendingSelection = clearPendingOrganizationSelection,
        resolveOwner = resolveOrganizationOwner,
        uploadImage = uploadWhatsappImageMessage,
    } = {}
) {
    // Bug fix (carga de imagen del evento): antes shouldAutoReply por sí
    // sola decidía si CUALQUIER mensaje seguía procesándose — como sólo
    // reconoce type==="text", un mensaje de imagen se descartaba acá mismo,
    // ANTES incluso de mirar si había una conversación activa esperando
    // justamente una imagen (paso COVER_IMAGE). shouldAutoReply no se toca
    // (sigue significando exactamente lo mismo, con los mismos tests); esta
    // es la única condición adicional, explícita, para dejar pasar un
    // mensaje de imagen con un media id real.
    const isProcessableImage = message?.type === "image" && Boolean(message.image?.id);
    if (!shouldAutoReply(message) && !isProcessableImage) return;

    // channelRef identifica la conversación de forma estable por el wa_id
    // de origen — SIEMPRE el número tal cual lo manda Meta (message.from),
    // nunca el normalizado de WHATSAPP_TEST_MODE: esa normalización es sólo
    // para el campo `to` del envío saliente (ver whatsapp.service.js Fase
    // 2D.1), no para identificar quién es quién.
    const channelRef = message.from;
    const to = normalizeWhatsappOutboundRecipient(message.from, isWhatsappTestModeEnabled());
    // Un mensaje de imagen no trae `text` (normalizeMessage lo deja null,
    // ver whatsapp.service.js) — nunca se le llama `.trim()` a null.
    const text = typeof message.text === "string" ? message.text.trim() : "";
    const reply = (replyText, engineAction) =>
        sendBotReply({ sendText, to, from: message.from, messageId: message.messageId, text: replyText, engineAction });

    try {
        const active = await findActiveConversation({ channel: WHATSAPP_CHANNEL, channelRef });

        // Bug fix (carga de imagen del evento): sólo tiene sentido procesar
        // una imagen si hay una conversación activa Y el paso en el que
        // está parada es justo IMAGE_URL (COVER_IMAGE). resume() es una
        // lectura pura (prisma.conversationState.findUnique + cálculo en
        // memoria, ver EventCreationEngine.js) — NUNCA avanza ni muta la
        // conversación, así que "espiar" el step actual acá no tiene ningún
        // costo de estado, sólo una consulta de más. Si el mensaje llega
        // sin conversación activa, se ignora igual que cualquier otro tipo
        // no reconocido (mismo comportamiento que antes de este fix).
        if (isProcessableImage) {
            if (!active) return;

            const currentState = await resumeConversation(active.id);
            if (currentState?.prompt?.inputType !== "IMAGE_URL") {
                await reply(`${WHATSAPP_IMAGE_NOT_EXPECTED_TEXT}\n\n${extractWhatsappReplyText(currentState)}`, "IMAGE_NOT_EXPECTED");
                return;
            }

            const uploadResult = await uploadImage(message.image.id);
            if (!uploadResult.success) {
                // NUNCA se llama a handleConversationInput acá: el motor
                // queda exactamente donde estaba, el organizador puede
                // volver a mandar otra imagen sin perder nada.
                await reply(buildWhatsappImageUploadErrorText(uploadResult.reason), "IMAGE_UPLOAD_ERROR");
                return;
            }

            const result = await handleConversationInput(active.id, { value: uploadResult.url });
            await reply(extractWhatsappReplyText(result), "IMAGE_UPLOADED");
            return;
        }

        if (active) {
            if (isCancelCommand(text)) {
                await cancelConversation(active.id, active.userId);
                await reply(WHATSAPP_CANCEL_TEXT, "CANCEL");
                return;
            }

            // Primer intento: SIEMPRE el texto crudo, igual que Web — el
            // motor no cambia de contrato. Sólo si ESE intento falla
            // (prompt.error) Y el step que rechazó la respuesta es
            // SINGLE_SELECT, se interpreta la respuesta como un índice
            // 1-based sobre `prompt.options` (la MISMA lista que el motor ya
            // devolvió) y se reintenta una única vez con el `id` real —
            // nunca se le pasa al motor un índice ni se inventa un id fuera
            // de esa lista. Si no es un índice válido, resolveSingleSelectIndexReply
            // devuelve null y el error original (con sus opciones, ver
            // extractWhatsappReplyText) es lo único que se manda.
            let result = await handleConversationInput(active.id, { value: text });
            if (result?.prompt?.error && result.prompt.inputType === "SINGLE_SELECT") {
                const resolvedId = resolveSingleSelectIndexReply(result.prompt.options, text);
                if (resolvedId) {
                    result = await handleConversationInput(active.id, { value: resolvedId });
                }
            }
            await reply(extractWhatsappReplyText(result), "HANDLE_INPUT");
            return;
        }

        const pendingSelection = await getPendingSelection(channelRef);

        if (pendingSelection) {
            if (isCancelCommand(text)) {
                await clearPendingSelection(channelRef);
                await reply(WHATSAPP_CANCEL_TEXT, "CANCEL");
                return;
            }

            if (pendingSelection.status === "AWAITING_SELECTION") {
                const choice = resolveOrganizationSelectionChoice(pendingSelection.candidateOrganizationIds, text);
                if (!choice.valid) {
                    await reply(WHATSAPP_SELECTION_INVALID_TEXT, "SELECTION_INVALID");
                    return;
                }

                const owner = await resolveOwner(choice.organizationId);
                if (!owner) {
                    // La Organization elegida dejó de estar APPROVED entre el
                    // descubrimiento y la elección — nunca se sigue con una
                    // Organization inválida.
                    await clearPendingSelection(channelRef);
                    await reply(WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT, "SELECTION_ORG_UNAVAILABLE");
                    return;
                }

                await confirmSelection(channelRef, choice.organizationId);
                await reply(buildOrganizationSelectedConfirmationText(owner.name), "SELECTION_CONFIRMED");
                return;
            }

            // pendingSelection.status === "AWAITING_CONFIRMATION"
            const owner = await resolveOwner(pendingSelection.selectedOrganizationId);
            if (!owner) {
                await clearPendingSelection(channelRef);
                await reply(WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT, "SELECTION_ORG_UNAVAILABLE");
                return;
            }

            const confirmationIntent = classifyInitialIntent(text);
            if (confirmationIntent === "AFFIRMATIVE") {
                await clearPendingSelection(channelRef);
                const startResult = await startConversation({
                    clerkId: owner.clerkId,
                    channel: WHATSAPP_CHANNEL,
                    channelRef,
                    organizationId: pendingSelection.selectedOrganizationId,
                });
                await reply(extractWhatsappReplyText(startResult), "START");
                return;
            }
            if (confirmationIntent === "NEGATIVE") {
                await clearPendingSelection(channelRef);
                await reply(WHATSAPP_DECLINE_TEXT, "DECLINE");
                return;
            }

            await reply(buildOrganizationSelectionConfirmationRetryText(owner.name), "SELECTION_CONFIRMATION_RETRY");
            return;
        }

        const intent = classifyInitialIntent(text);
        const candidates = await discoverCandidates(channelRef);

        if (candidates.length === 0) {
            await reply(WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT, "ORGANIZATION_NOT_FOUND");
            return;
        }

        if (candidates.length === 1) {
            const [organization] = candidates;

            if (intent === "AFFIRMATIVE") {
                const startResult = await startConversation({
                    clerkId: organization.clerkId,
                    channel: WHATSAPP_CHANNEL,
                    channelRef,
                    organizationId: organization.organizationId,
                });
                await reply(extractWhatsappReplyText(startResult), "START");
                return;
            }

            if (intent === "NEGATIVE") {
                await reply(WHATSAPP_DECLINE_TEXT, "DECLINE");
                return;
            }

            await reply(buildKnownOrganizationGreetingText(organization.name), "GREETING");
            return;
        }

        // candidates.length > 1 — Caso B: selector numerado explícito.
        if (intent === "NEGATIVE") {
            await reply(WHATSAPP_DECLINE_TEXT, "DECLINE");
            return;
        }

        await createPendingSelection(
            channelRef,
            candidates.map((candidate) => candidate.organizationId)
        );
        await reply(buildOrganizationSelectorText(candidates), "SELECTOR");
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
