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
    isBackCommand,
    extractWhatsappReplyText,
    resolveSingleSelectIndexReply,
    parseWhatsappFunctionCardDateText,
    isArgentineDateInThePast,
    parseWhatsappStreetNumberText,
    resolveArgentinaProvinceIndexReply,
    WHATSAPP_DECLINE_TEXT,
    WHATSAPP_CANCEL_TEXT,
    WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT,
    WHATSAPP_SELECTION_INVALID_TEXT,
    WHATSAPP_IMAGE_NOT_EXPECTED_TEXT,
    WHATSAPP_LOCATION_NOT_EXPECTED_TEXT,
    WHATSAPP_LOCATION_INSUFFICIENT_TEXT,
    WHATSAPP_LOCATION_METHOD_PROMPT_TEXT,
    WHATSAPP_LOCATION_METHOD_INVALID_TEXT,
    WHATSAPP_LOCATION_SHARE_PROMPT_TEXT,
    WHATSAPP_LOCATION_SHARE_RETRY_TEXT,
    WHATSAPP_LOCATION_STREET_PROMPT_TEXT,
    WHATSAPP_LOCATION_STREET_INVALID_TEXT,
    WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT,
    WHATSAPP_LOCATION_STREET_NUMBER_INVALID_TEXT,
    WHATSAPP_LOCATION_CITY_PROMPT_TEXT,
    WHATSAPP_LOCATION_CITY_INVALID_TEXT,
    WHATSAPP_LOCATION_COMMIT_ERROR_TEXT,
    WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT,
    WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT,
    WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT,
    WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT,
    WHATSAPP_FUNCTION_CARD_DATE_PROMPT_TEXT,
    buildKnownOrganizationGreetingText,
    buildOrganizationSelectorText,
    buildOrganizationSelectedConfirmationText,
    buildOrganizationSelectionConfirmationRetryText,
    buildWhatsappImageUploadErrorText,
    buildLocationInputFromWhatsapp,
    isPublishableWhatsappLocation,
    buildLocationProvincePromptText,
    buildLocationProvinceInvalidText,
    buildWhatsappFunctionsListDatePromptText,
    buildWhatsappFunctionAddedSummaryText,
    WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT,
    WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT,
    WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT,
    isRecurringToBeforeFrom,
    WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT,
    WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_COMMIT_ERROR_TEXT,
    parseWhatsappWeekdaySelection,
    buildWhatsappWeekdaysConfirmationText,
    buildWhatsappRecurringStartTimePromptText,
    WHATSAPP_RECURRING_START_TIME_NEXT_PROMPT_TEXT,
    buildWhatsappScheduleAddedSummaryText,
    WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_NO_OCCURRENCES_TEXT,
    resolveWhatsappYesNoReply,
    resolveWhatsappPreviewChoice,
    WHATSAPP_PREVIEW_INVALID_TEXT,
    buildWhatsappLocationConfirmationText,
} from "../services/whatsappOrganizerBot.service.js";
import { uploadWhatsappImageMessage } from "../services/whatsappMediaUpload.service.js";
import { isValidTimeString } from "../conversation/inputHandlers/time.js";
import {
    getPendingStepInput,
    resetPendingStepInput,
    updatePendingStepInputStatus,
    deletePendingStepInput,
} from "../services/whatsappPendingStepInput.service.js";

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

// Fase 3G, sección 1 — CAUSA RAÍZ del bug "SINGLE termina y pide 'la primera
// función'": FUNCTIONS_SINGLE_CARD.next() y FUNCTIONS_RECURRING_SCHEDULES.next()
// (steps/definitions.js) apuntan AMBOS al mismo step terminal FUNCTIONS_LIST
// — el "Administrador de Agenda" único al que llegan las tres ramas de
// FUNCTIONS_MODE (SINGLE/MULTIPLE/RECURRING). Para SINGLE,
// FUNCTIONS_SINGLE_CARD.setValue ya deja `_functionsDraft.slots = [value]`
// (una función); para RECURRING, generateRecurringSlots ya la puebla con
// las funciones generadas (ver comentario de tryHandleRecurringSchedulesSubflow,
// Fase 3F). En AMBOS casos, `result.prompt.slots` llega a FUNCTIONS_LIST ya
// completo — a diferencia de MULTIPLE, que llega ahí con la lista vacía y
// SÍ necesita el ciclo manual de tryHandleFunctionsListSubflow (Fase 3E).
// Antes de esta fase, nada distinguía un caso del otro: cualquier llegada a
// FUNCTIONS_LIST mostraba el prompt de "primera función" y esperaba carga
// manual — incluso cuando ya había una función (o N) completa esperando
// confirmación. La corrección es exclusivamente de adaptador: confirmar
// automáticamente esos slots ya generados, sin pedirle nada al organizador
// ni reimplementar ninguna lógica de negocio (nunca se recalcula nada,
// sólo se reenvía `prompt.slots` tal cual). Se usa EXCLUSIVAMENTE desde los
// dos puntos donde se sabe con certeza que el step recién confirmado fue
// FUNCTIONS_SINGLE_CARD o FUNCTIONS_RECURRING_SCHEDULES — nunca de forma
// genérica — así que MULTIPLE (que llega con slots=[] la primera vez) nunca
// se ve afectado.
async function commitPrefilledFunctionsListIfNeeded(conversationId, result, handleConversationInput) {
    if (result?.prompt?.stepId !== "FUNCTIONS_LIST") return result;
    const slots = result.prompt.slots ?? [];
    if (slots.length === 0) return result;
    return handleConversationInput(conversationId, { value: slots });
}

// Fase 3C — único consumidor real de WhatsappPendingStepInput hasta ahora.
// Divide el step FUNCTIONS_SINGLE_CARD (inputType FUNCTION_CARD — el motor
// exige {date,startTime,endTime} en UNA sola respuesta, ver
// inputHandlers/functionCard.js) en 3 mensajes de WhatsApp: fecha, hora de
// inicio, hora de fin. El motor NUNCA recibe un dato suelto — sólo el
// objeto completo, y sólo una vez, al final.
//
// Devuelve {handled:true} si ya mandó una respuesta y el árbol de decisión
// normal de processInboundMessage no debe seguir con este mensaje;
// {handled:false} si el mensaje no pertenece a este sub-flujo (no había un
// pending para FUNCTIONS_SINGLE_CARD y el step actual tampoco lo es), y
// debe seguir su camino normal (SINGLE_SELECT, texto libre genérico, etc.).
//
// Protección contra estado viejo (Fase 3B, sección 5 del pedido): un
// pending de OTRO stepId nunca se reutiliza — se descarta explícitamente
// (resetPendingStepInput) recién cuando se confirma que el step REAL
// vigente es FUNCTIONS_SINGLE_CARD.
async function tryHandleFunctionCardSubflow({
    conversationId,
    text,
    reply,
    handleConversationInput,
    resumeConversation,
    getPendingStepInput: getPendingStepInputDep,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    // Fase 3D — con DOS steps consumiendo WhatsappPendingStepInput
    // (FUNCTIONS_SINGLE_CARD y LOCATION), un pending que matchea el stepId
    // propio YA NO alcanza como prueba de validez por sí solo: hay que
    // confirmar TAMBIÉN que el step REAL vigente (resumeConversation, nunca
    // el pending) sigue siendo éste. Sin este chequeo, un pending viejo de
    // FUNCTIONS_SINGLE_CARD que por algún motivo sobrevivió mientras la
    // conversación ya avanzó a otro step (ej. LOCATION) sería reutilizado
    // en silencio — exactamente lo que la sección 5 del pedido de Fase 3B
    // prohíbe ("el stepId real es la fuente de verdad").
    const currentState = await resumeConversation(conversationId);
    const isCurrentStepFunctionCard = currentState?.prompt?.stepId === "FUNCTIONS_SINGLE_CARD";

    let pending = await getPendingStepInputDep(conversationId);
    if (pending && (pending.stepId !== "FUNCTIONS_SINGLE_CARD" || !isCurrentStepFunctionCard)) {
        pending = null;
    }

    if (!isCurrentStepFunctionCard) {
        return { handled: false, currentState };
    }

    if (!pending) {
        // Recién acá se confirma que el step real es FUNCTIONS_SINGLE_CARD:
        // se arranca (o se resetea uno viejo de otro step) un pending
        // nuevo. El prompt de fecha ya se mostró al llegar a este step (ver
        // extractWhatsappReplyText#inputType==="FUNCTION_CARD") — el `text`
        // que acaba de llegar ES la respuesta a esa pregunta, así que se
        // sigue evaluando abajo, sin volver a preguntar.
        pending = await resetPendingStepInputDep(conversationId, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE");
    }

    const wantsBack = isBackCommand(text);

    if (pending.status === "AWAITING_DATE") {
        if (wantsBack) {
            // Fase 3D, sección 9 — primer sub-paso: NO hay otro sub-estado
            // anterior dentro de este pending al cual volver. Auditado: el
            // motor SÍ expone un BACK real y seguro (handleInput con
            // {action:"BACK"} sólo mueve currentStepId/history, agnóstico
            // al inputType del step actual — ver EventCreationEngine.js) y
            // es exactamente lo que ya usa la Web. currentStepId sigue
            // siendo FUNCTIONS_SINGLE_CARD en todo momento durante este
            // sub-flujo (nunca se llamó a handleInput todavía), así que
            // llamarlo acá retrocede correctamente a FUNCTIONS_MODE.
            const backResult = await handleConversationInput(conversationId, { action: "BACK" });
            if (backResult?.prompt?.error) {
                // No debería pasar en la práctica (FUNCTIONS_SINGLE_CARD
                // siempre tiene varios steps antes) — si pasara, el pending
                // queda intacto en este mismo sub-paso.
                await reply(extractWhatsappReplyText(backResult), "FUNCTION_CARD_BACK_REJECTED");
                return { handled: true };
            }
            await deletePendingStepInputDep(conversationId);
            await reply(extractWhatsappReplyText(backResult), "FUNCTION_CARD_BACK_TO_PREVIOUS_STEP");
            return { handled: true };
        }

        const normalizedDate = parseWhatsappFunctionCardDateText(text);
        if (!normalizedDate) {
            await reply(WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT, "FUNCTION_CARD_DATE_INVALID");
            return { handled: true };
        }
        if (isArgentineDateInThePast(normalizedDate)) {
            await reply(WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT, "FUNCTION_CARD_DATE_PAST");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_START_TIME", { date: normalizedDate });
        await reply(WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT, "FUNCTION_CARD_START_TIME_PROMPT");
        return { handled: true };
    }

    if (pending.status === "AWAITING_START_TIME") {
        if (wantsBack) {
            // Vuelve a AWAITING_DATE: elimina `date` (el único campo
            // confirmado hasta acá) — se vuelve a pedir desde cero.
            await updatePendingStepInputStatusDep(conversationId, "AWAITING_DATE", {});
            await reply(WHATSAPP_FUNCTION_CARD_DATE_PROMPT_TEXT, "FUNCTION_CARD_BACK_TO_DATE");
            return { handled: true };
        }

        const trimmed = typeof text === "string" ? text.trim() : "";
        if (!isValidTimeString(trimmed)) {
            await reply(WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT, "FUNCTION_CARD_TIME_INVALID");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_END_TIME", {
            ...pending.partialData,
            startTime: trimmed,
        });
        await reply(WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT, "FUNCTION_CARD_END_TIME_PROMPT");
        return { handled: true };
    }

    // pending.status === "AWAITING_END_TIME"
    if (wantsBack) {
        // Vuelve a AWAITING_START_TIME: mantiene `date`, elimina `startTime`
        // (el campo que se recolectó para llegar a AWAITING_END_TIME).
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_START_TIME", { date: pending.partialData.date });
        await reply(WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT, "FUNCTION_CARD_BACK_TO_START_TIME");
        return { handled: true };
    }

    const trimmedEndTime = typeof text === "string" ? text.trim() : "";
    if (!isValidTimeString(trimmedEndTime)) {
        await reply(WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT, "FUNCTION_CARD_TIME_INVALID");
        return { handled: true };
    }

    const finalValue = {
        date: pending.partialData.date,
        startTime: pending.partialData.startTime,
        endTime: trimmedEndTime,
    };
    const result = await handleConversationInput(conversationId, { value: finalValue });

    if (result?.prompt?.error) {
        // No debería pasar nunca en la práctica (fecha y horarios ya se
        // validaron uno por uno con los mismos validadores reales del
        // motor antes de llegar acá) — pero si pasa, comportamiento mínimo
        // seguro: NUNCA se pierden fecha/hora de inicio ya confirmadas, el
        // pending queda intacto (sigue en AWAITING_END_TIME) para que sólo
        // haga falta reintentar la hora de fin.
        await reply(WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT, "FUNCTION_CARD_COMMIT_ERROR");
        return { handled: true };
    }

    // Fase 3G, sección 1 — el motor avanzó a FUNCTIONS_LIST con esta única
    // función ya en `prompt.slots` (ver comentario de
    // commitPrefilledFunctionsListIfNeeded): se confirma automáticamente,
    // nunca se le pide al organizador que la vuelva a cargar a mano.
    const finalResult = await commitPrefilledFunctionsListIfNeeded(conversationId, result, handleConversationInput);
    if (finalResult?.prompt?.error) {
        // Defensivo — no debería pasar nunca (la función ya es válida por
        // construcción). Mismo texto/estado que el rechazo de arriba: el
        // pending sigue en AWAITING_END_TIME, recuperable reintentando la
        // hora de fin.
        await reply(WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT, "FUNCTION_CARD_COMMIT_ERROR");
        return { handled: true };
    }

    await deletePendingStepInputDep(conversationId);
    await reply(extractWhatsappReplyText(finalResult), "FUNCTION_CARD_COMPLETED");
    return { handled: true };
}

// Fase 3D — segundo consumidor de WhatsappPendingStepInput: divide el step
// LOCATION en una conversación de verdad (una pregunta = un dato) con dos
// caminos:
//   A) compartir ubicación nativa (reutiliza TAL CUAL
//      buildLocationInputFromWhatsapp/isPublishableWhatsappLocation, sin
//      duplicar nada de la lógica ya aprobada);
//   B) dirección manual paso a paso (calle → altura → ciudad → provincia
//      numerada), sin geocodificar ni tocar Google Maps — arma exactamente
//      el shape que ya acepta inputHandlers/location.js.
// El motor recibe LOCATION una única vez, recién al completar cualquiera
// de los dos caminos. Se invoca desde DOS lugares de processInboundMessage:
// cuando llega un mensaje type==="location" (antes sólo se procesaba
// directo) y cuando llega texto con conversación activa (selección de
// método, campos manuales, "volver").
//
// Mismo contrato de retorno que tryHandleFunctionCardSubflow:
// {handled:false} sólo cuando no hay pending de LOCATION y el step real
// vigente tampoco lo es — el caller decide qué hacer en ese caso (hoy:
// avisar "no necesito ubicación acá" para un mensaje de tipo location, o
// seguir el árbol normal para texto).
async function tryHandleLocationSubflow({
    conversationId,
    message,
    text,
    reply,
    handleConversationInput,
    resumeConversation,
    getPendingStepInput: getPendingStepInputDep,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    // Fase 3D — mismo chequeo reforzado que tryHandleFunctionCardSubflow:
    // el step REAL vigente (nunca el stepId grabado en el pending) es la
    // única fuente de verdad de si este pending sigue siendo válido —
    // necesario ahora que hay DOS steps distintos consumiendo
    // WhatsappPendingStepInput.
    const currentState = await resumeConversation(conversationId);
    const isCurrentStepLocation = currentState?.prompt?.stepId === "LOCATION";

    let pending = await getPendingStepInputDep(conversationId);
    if (pending && (pending.stepId !== "LOCATION" || !isCurrentStepLocation)) {
        pending = null;
    }

    if (!isCurrentStepLocation) {
        // Se devuelve el `currentState` ya resuelto para que el caller
        // (processInboundMessage) no tenga que volver a llamar
        // resumeConversation (misma lectura, evitar la consulta doble).
        return { handled: false, currentState };
    }

    if (!pending) {
        // El prompt de método ya se mostró al llegar a este step (ver
        // extractWhatsappReplyText#inputType==="LOCATION") — el mensaje que
        // acaba de llegar ES la respuesta a esa pregunta.
        pending = await resetPendingStepInputDep(conversationId, "LOCATION", "AWAITING_LOCATION_METHOD");
    }

    const wantsBack = message.type === "text" && isBackCommand(text);

    if (pending.status === "AWAITING_LOCATION_METHOD") {
        if (wantsBack) {
            // Fase 3D, sección 9 — mismo mecanismo auditado y ya usado para
            // FUNCTIONS_SINGLE_CARD: BACK real del motor (agnóstico al
            // inputType del step actual), currentStepId sigue siendo
            // LOCATION durante todo este sub-flujo.
            const backResult = await handleConversationInput(conversationId, { action: "BACK" });
            if (backResult?.prompt?.error) {
                await reply(extractWhatsappReplyText(backResult), "LOCATION_BACK_REJECTED");
                return { handled: true };
            }
            await deletePendingStepInputDep(conversationId);
            await reply(extractWhatsappReplyText(backResult), "LOCATION_BACK_TO_PREVIOUS_STEP");
            return { handled: true };
        }

        if (message.type === "text") {
            const choice = text.trim();
            if (choice === "1") {
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_LOCATION_SHARE", {});
                await reply(WHATSAPP_LOCATION_SHARE_PROMPT_TEXT, "LOCATION_SHARE_PROMPT");
                return { handled: true };
            }
            if (choice === "2") {
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_STREET", {});
                await reply(WHATSAPP_LOCATION_STREET_PROMPT_TEXT, "LOCATION_STREET_PROMPT");
                return { handled: true };
            }
        }
        await reply(WHATSAPP_LOCATION_METHOD_INVALID_TEXT, "LOCATION_METHOD_INVALID");
        return { handled: true };
    }

    if (pending.status === "AWAITING_LOCATION_SHARE") {
        if (wantsBack) {
            await resetPendingStepInputDep(conversationId, "LOCATION", "AWAITING_LOCATION_METHOD");
            await reply(WHATSAPP_LOCATION_METHOD_PROMPT_TEXT, "LOCATION_METHOD_PROMPT");
            return { handled: true };
        }
        if (message.type !== "location") {
            await reply(WHATSAPP_LOCATION_SHARE_RETRY_TEXT, "LOCATION_SHARE_RETRY");
            return { handled: true };
        }
        // Pre-validación (idéntica a la ya aprobada): un pin sin `address`
        // nunca va a poder publicarse después — se rechaza antes de tocar
        // el motor, sin avanzar el sub-estado.
        if (!isPublishableWhatsappLocation(message.location)) {
            await reply(WHATSAPP_LOCATION_INSUFFICIENT_TEXT, "LOCATION_INSUFFICIENT");
            return { handled: true };
        }

        // Fase 3G, sección 4 — ya no se manda al motor acá: se guarda el
        // objeto ya construido y se pide confirmación explícita primero
        // (mismo criterio para las dos modalidades, ver AWAITING_LOCATION_CONFIRMATION).
        const location = buildLocationInputFromWhatsapp(message.location);
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_LOCATION_CONFIRMATION", { location });
        await reply(buildWhatsappLocationConfirmationText(location), "LOCATION_CONFIRMATION_PROMPT");
        return { handled: true };
    }

    // A partir de acá (dirección manual) sólo el texto tiene sentido.
    if (pending.status === "AWAITING_STREET") {
        if (wantsBack) {
            await resetPendingStepInputDep(conversationId, "LOCATION", "AWAITING_LOCATION_METHOD");
            await reply(WHATSAPP_LOCATION_METHOD_PROMPT_TEXT, "LOCATION_METHOD_PROMPT");
            return { handled: true };
        }
        const street = message.type === "text" ? text.trim() : "";
        if (!street) {
            await reply(WHATSAPP_LOCATION_STREET_INVALID_TEXT, "LOCATION_STREET_INVALID");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_STREET_NUMBER", { street });
        await reply(WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT, "LOCATION_STREET_NUMBER_PROMPT");
        return { handled: true };
    }

    if (pending.status === "AWAITING_STREET_NUMBER") {
        if (wantsBack) {
            // Vuelve a AWAITING_STREET: elimina `street` (se re-pregunta desde cero).
            await updatePendingStepInputStatusDep(conversationId, "AWAITING_STREET", {});
            await reply(WHATSAPP_LOCATION_STREET_PROMPT_TEXT, "LOCATION_BACK_TO_STREET");
            return { handled: true };
        }
        const streetNumber = message.type === "text" ? parseWhatsappStreetNumberText(text) : null;
        if (!streetNumber) {
            await reply(WHATSAPP_LOCATION_STREET_NUMBER_INVALID_TEXT, "LOCATION_STREET_NUMBER_INVALID");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_CITY", { ...pending.partialData, streetNumber });
        await reply(WHATSAPP_LOCATION_CITY_PROMPT_TEXT, "LOCATION_CITY_PROMPT");
        return { handled: true };
    }

    if (pending.status === "AWAITING_CITY") {
        if (wantsBack) {
            // Vuelve a AWAITING_STREET_NUMBER: mantiene `street`, elimina `streetNumber`.
            await updatePendingStepInputStatusDep(conversationId, "AWAITING_STREET_NUMBER", { street: pending.partialData.street });
            await reply(WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT, "LOCATION_BACK_TO_STREET_NUMBER");
            return { handled: true };
        }
        const city = message.type === "text" ? text.trim() : "";
        if (!city) {
            await reply(WHATSAPP_LOCATION_CITY_INVALID_TEXT, "LOCATION_CITY_INVALID");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_PROVINCE", { ...pending.partialData, city });
        await reply(buildLocationProvincePromptText(), "LOCATION_PROVINCE_PROMPT");
        return { handled: true };
    }

    if (pending.status === "AWAITING_PROVINCE") {
        if (wantsBack) {
            // Vuelve a AWAITING_CITY: mantiene street/streetNumber, elimina `city`.
            await updatePendingStepInputStatusDep(conversationId, "AWAITING_CITY", {
                street: pending.partialData.street,
                streetNumber: pending.partialData.streetNumber,
            });
            await reply(WHATSAPP_LOCATION_CITY_PROMPT_TEXT, "LOCATION_BACK_TO_CITY");
            return { handled: true };
        }

        const province = message.type === "text" ? resolveArgentinaProvinceIndexReply(text) : null;
        if (!province) {
            await reply(buildLocationProvinceInvalidText(), "LOCATION_PROVINCE_INVALID");
            return { handled: true };
        }

        // assertPublishable (event.service.js) exige venueName + dirección —
        // EventServicePort#buildLocationInput ya deriva venueName = address
        // cuando no hay nombre de lugar (misma convención que el modo manual
        // sin mapa de la Web, ver LocationAnswer.jsx#ManualLocationForm): no
        // se inventa ningún venueName acá, queda null y cae en ese fallback
        // ya existente. latitude/longitude/googlePlaceId null a propósito —
        // nunca se geocodifica.
        const { street, streetNumber, city } = pending.partialData;
        const location = {
            address: `${street} ${streetNumber}`,
            city,
            province,
            venueName: null,
            latitude: null,
            longitude: null,
            googlePlaceId: null,
        };
        // Fase 3G, sección 4 — mismo criterio que el camino "compartir":
        // se pide confirmación ANTES de tocar el motor.
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_LOCATION_CONFIRMATION", { location });
        await reply(buildWhatsappLocationConfirmationText(location), "LOCATION_CONFIRMATION_PROMPT");
        return { handled: true };
    }

    // pending.status === "AWAITING_LOCATION_CONFIRMATION"
    if (wantsBack) {
        // Sección 4 del pedido — "preferentemente volver a selección del
        // método" (cambio mínimo coherente, sin reconstruir los sub-campos
        // ya descartados de la dirección manual).
        await resetPendingStepInputDep(conversationId, "LOCATION", "AWAITING_LOCATION_METHOD", {});
        await reply(WHATSAPP_LOCATION_METHOD_PROMPT_TEXT, "LOCATION_METHOD_PROMPT");
        return { handled: true };
    }

    if (message.type !== "text") {
        await reply(buildWhatsappLocationConfirmationText(pending.partialData.location), "LOCATION_CONFIRMATION_INVALID");
        return { handled: true };
    }

    // Reutiliza classifyInitialIntent (ya acepta "1"/"2"/"sí"/"no"), igual
    // que el resto de las decisiones Sí/No de fases anteriores.
    const confirmIntent = classifyInitialIntent(text);
    if (confirmIntent === "AFFIRMATIVE") {
        // Se manda EXACTAMENTE el objeto ya construido — nunca se vuelve a
        // armar ni se toca acá.
        const result = await handleConversationInput(conversationId, { value: pending.partialData.location });
        if (result?.prompt?.error) {
            await reply(WHATSAPP_LOCATION_COMMIT_ERROR_TEXT, "LOCATION_COMMIT_ERROR");
            return { handled: true };
        }
        await deletePendingStepInputDep(conversationId);
        await reply(extractWhatsappReplyText(result), "LOCATION_CONFIRMED");
        return { handled: true };
    }
    if (confirmIntent === "NEGATIVE") {
        // Descarta los datos temporales de ubicación y vuelve a preguntar
        // el método desde cero — nunca se le pasa nada al motor.
        await resetPendingStepInputDep(conversationId, "LOCATION", "AWAITING_LOCATION_METHOD", {});
        await reply(WHATSAPP_LOCATION_METHOD_PROMPT_TEXT, "LOCATION_METHOD_PROMPT");
        return { handled: true };
    }

    await reply(buildWhatsappLocationConfirmationText(pending.partialData.location), "LOCATION_CONFIRMATION_INVALID");
    return { handled: true };
}

// Fase 3E — tercer consumidor de WhatsappPendingStepInput: divide el step
// FUNCTIONS_LIST (inputType FUNCTIONS_LIST, modo MULTIPLE de FUNCTIONS_MODE,
// "varias funciones") en un ciclo conversacional — fecha -> hora de inicio
// -> hora de fin -> ¿agregar otra? -> repetir o finalizar — reutilizando tal
// cual los mismos validadores/parsers de fecha y hora ya aprobados en Fase
// 3C para FUNCTIONS_SINGLE_CARD. El motor NUNCA recibe una función suelta:
// sólo el array completo, y sólo una vez, cuando el organizador responde "2"
// (no quiere agregar otra).
//
// `partialData` guarda la separación conceptual pedida:
//   { functions: [...ya confirmadas], current: {...en construcción} }
// Mismo contrato de retorno que los otros dos tryHandle*Subflow.
async function tryHandleFunctionsListSubflow({
    conversationId,
    text,
    reply,
    handleConversationInput,
    resumeConversation,
    getPendingStepInput: getPendingStepInputDep,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    // Fase 3D/3E — mismo chequeo reforzado que los otros dos sub-flujos: el
    // step REAL vigente (nunca el stepId grabado en el pending) es la única
    // fuente de verdad de si este pending sigue siendo válido — ahora con
    // TRES steps distintos consumiendo WhatsappPendingStepInput.
    const currentState = await resumeConversation(conversationId);
    const isCurrentStepFunctionsList = currentState?.prompt?.stepId === "FUNCTIONS_LIST";

    let pending = await getPendingStepInputDep(conversationId);
    if (pending && (pending.stepId !== "FUNCTIONS_LIST" || !isCurrentStepFunctionsList)) {
        pending = null;
    }

    if (!isCurrentStepFunctionsList) {
        return { handled: false, currentState };
    }

    if (!pending) {
        // El prompt de "primera función" ya se mostró al llegar a este step
        // (ver extractWhatsappReplyText#inputType==="FUNCTIONS_LIST") — el
        // `text` que acaba de llegar ES la respuesta a esa pregunta.
        pending = await resetPendingStepInputDep(conversationId, "FUNCTIONS_LIST", "AWAITING_MULTIPLE_DATE", {
            functions: [],
            current: {},
        });
    }

    const wantsBack = isBackCommand(text);
    const functions = pending.partialData?.functions ?? [];
    const current = pending.partialData?.current ?? {};

    if (pending.status === "AWAITING_MULTIPLE_DATE") {
        if (wantsBack) {
            if (functions.length > 0) {
                // Sección 10.C — todavía no se escribió nada de esta función
                // nueva: volver conceptualmente a la decisión posterior a la
                // función anterior, sin tocar las ya confirmadas.
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_ADD_ANOTHER", {
                    functions,
                    current: {},
                });
                const lastFn = functions[functions.length - 1];
                await reply(buildWhatsappFunctionAddedSummaryText(lastFn), "FUNCTIONS_LIST_BACK_TO_ADD_ANOTHER");
                return { handled: true };
            }

            // Sección 10.E — primera función, ningún sub-paso anterior
            // dentro de este pending al cual volver: mismo BACK real del
            // motor ya auditado y usado en FUNCTIONS_SINGLE_CARD/LOCATION
            // (currentStepId sigue siendo FUNCTIONS_LIST en todo momento
            // durante este sub-flujo, nunca se llamó a handleConversationInput
            // todavía).
            const backResult = await handleConversationInput(conversationId, { action: "BACK" });
            if (backResult?.prompt?.error) {
                await reply(extractWhatsappReplyText(backResult), "FUNCTIONS_LIST_BACK_REJECTED");
                return { handled: true };
            }
            await deletePendingStepInputDep(conversationId);
            await reply(extractWhatsappReplyText(backResult), "FUNCTIONS_LIST_BACK_TO_PREVIOUS_STEP");
            return { handled: true };
        }

        const normalizedDate = parseWhatsappFunctionCardDateText(text);
        if (!normalizedDate) {
            await reply(WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT, "FUNCTIONS_LIST_DATE_INVALID");
            return { handled: true };
        }
        if (isArgentineDateInThePast(normalizedDate)) {
            await reply(WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT, "FUNCTIONS_LIST_DATE_PAST");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_START_TIME", {
            functions,
            current: { date: normalizedDate },
        });
        await reply(WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT, "FUNCTIONS_LIST_START_TIME_PROMPT");
        return { handled: true };
    }

    if (pending.status === "AWAITING_MULTIPLE_START_TIME") {
        if (wantsBack) {
            // Vuelve a AWAITING_MULTIPLE_DATE: elimina toda la función en
            // curso (el único campo confirmado hasta acá era `date`) — se
            // vuelve a pedir desde cero. Las funciones anteriores no se tocan.
            await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_DATE", { functions, current: {} });
            await reply(buildWhatsappFunctionsListDatePromptText(functions.length === 0), "FUNCTIONS_LIST_BACK_TO_DATE");
            return { handled: true };
        }

        const trimmed = typeof text === "string" ? text.trim() : "";
        if (!isValidTimeString(trimmed)) {
            await reply(WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT, "FUNCTIONS_LIST_TIME_INVALID");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_END_TIME", {
            functions,
            current: { ...current, startTime: trimmed },
        });
        await reply(WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT, "FUNCTIONS_LIST_END_TIME_PROMPT");
        return { handled: true };
    }

    if (pending.status === "AWAITING_MULTIPLE_END_TIME") {
        if (wantsBack) {
            // Vuelve a AWAITING_MULTIPLE_START_TIME: mantiene `date`,
            // elimina `startTime` (el campo recolectado para llegar acá).
            await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_START_TIME", {
                functions,
                current: { date: current.date },
            });
            await reply(WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT, "FUNCTIONS_LIST_BACK_TO_START_TIME");
            return { handled: true };
        }

        const trimmedEndTime = typeof text === "string" ? text.trim() : "";
        if (!isValidTimeString(trimmedEndTime)) {
            await reply(WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT, "FUNCTIONS_LIST_TIME_INVALID");
            return { handled: true };
        }

        const completedFunction = { date: current.date, startTime: current.startTime, endTime: trimmedEndTime };
        const updatedFunctions = [...functions, completedFunction];
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_ADD_ANOTHER", {
            functions: updatedFunctions,
            current: {},
        });
        await reply(buildWhatsappFunctionAddedSummaryText(completedFunction), "FUNCTIONS_LIST_FUNCTION_ADDED");
        return { handled: true };
    }

    // pending.status === "AWAITING_MULTIPLE_ADD_ANOTHER"
    if (wantsBack) {
        // Sección 10.D — corregir la ÚLTIMA función agregada: se saca
        // temporalmente de `functions`, se cargan sus valores en `current` y
        // se vuelve a preguntar la hora de fin (de ahí, "volver" sigue
        // encadenando hacia hora de inicio y fecha con la semántica normal
        // de cada sub-paso).
        const lastFn = functions[functions.length - 1];
        const remainingFunctions = functions.slice(0, -1);
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_END_TIME", {
            functions: remainingFunctions,
            current: { date: lastFn.date, startTime: lastFn.startTime, endTime: lastFn.endTime },
        });
        await reply(WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT, "FUNCTIONS_LIST_EDIT_LAST_FUNCTION");
        return { handled: true };
    }

    // Reutiliza classifyInitialIntent (ya acepta "1"/"2" y, adicionalmente,
    // "sí"/"si"/"no" — sección 9 del pedido) en vez de reimplementar otro
    // clasificador Sí/No.
    const intent = classifyInitialIntent(text);
    if (intent === "AFFIRMATIVE") {
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_MULTIPLE_DATE", { functions, current: {} });
        await reply(buildWhatsappFunctionsListDatePromptText(false), "FUNCTIONS_LIST_ADD_ANOTHER");
        return { handled: true };
    }
    if (intent === "NEGATIVE") {
        const result = await handleConversationInput(conversationId, { value: functions });
        if (result?.prompt?.error) {
            // Sección 14 — nunca se borra el pending antes de saber que el
            // motor aceptó el array: si lo rechaza, todas las funciones
            // siguen ahí, el organizador puede reintentar "2" o agregar otra.
            await reply(WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT, "FUNCTIONS_LIST_COMMIT_ERROR");
            return { handled: true };
        }
        await deletePendingStepInputDep(conversationId);
        await reply(extractWhatsappReplyText(result), "FUNCTIONS_LIST_COMPLETED");
        return { handled: true };
    }

    await reply(WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT, "FUNCTIONS_LIST_ADD_ANOTHER_INVALID");
    return { handled: true };
}

// Fase 3F — cuarto consumidor de WhatsappPendingStepInput: divide el step
// FUNCTIONS_RANGE (inputType DATE_RANGE, primer paso de RECURRING) en dos
// preguntas — fecha desde, fecha hasta — reutilizando tal cual los mismos
// validadores de fecha/"hoy Argentina" de Fase 3C. El motor recibe
// {from,to} UNA sola vez, sólo cuando ambas fechas ya son válidas (incluida
// "hasta >= desde", la misma regla que ya exige inputHandlers/dateRange.js,
// validada acá ANTES de llamar al motor para no gastar un viaje que ya
// sabemos que va a fallar — ver isRecurringToBeforeFrom).
async function tryHandleRecurringRangeSubflow({
    conversationId,
    text,
    reply,
    handleConversationInput,
    resumeConversation,
    getPendingStepInput: getPendingStepInputDep,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    const currentState = await resumeConversation(conversationId);
    const isCurrentStepRange = currentState?.prompt?.stepId === "FUNCTIONS_RANGE";

    let pending = await getPendingStepInputDep(conversationId);
    if (pending && (pending.stepId !== "FUNCTIONS_RANGE" || !isCurrentStepRange)) {
        pending = null;
    }

    if (!isCurrentStepRange) {
        return { handled: false, currentState };
    }

    if (!pending) {
        pending = await resetPendingStepInputDep(conversationId, "FUNCTIONS_RANGE", "AWAITING_RECURRING_FROM_DATE", {});
    }

    const wantsBack = isBackCommand(text);

    if (pending.status === "AWAITING_RECURRING_FROM_DATE") {
        if (wantsBack) {
            // Sección 17.B — primer sub-paso, sin nada anterior dentro de
            // este pending: BACK real del motor (mismo mecanismo auditado y
            // ya usado en las tres fases anteriores), vuelve a FUNCTIONS_MODE.
            const backResult = await handleConversationInput(conversationId, { action: "BACK" });
            if (backResult?.prompt?.error) {
                await reply(extractWhatsappReplyText(backResult), "RECURRING_RANGE_BACK_REJECTED");
                return { handled: true };
            }
            await deletePendingStepInputDep(conversationId);
            await reply(extractWhatsappReplyText(backResult), "RECURRING_RANGE_BACK_TO_PREVIOUS_STEP");
            return { handled: true };
        }

        const normalizedFrom = parseWhatsappFunctionCardDateText(text);
        if (!normalizedFrom) {
            await reply(WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT, "RECURRING_RANGE_FROM_INVALID");
            return { handled: true };
        }
        if (isArgentineDateInThePast(normalizedFrom)) {
            await reply(WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT, "RECURRING_RANGE_FROM_PAST");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_TO_DATE", { from: normalizedFrom });
        await reply(WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT, "RECURRING_RANGE_TO_PROMPT");
        return { handled: true };
    }

    // pending.status === "AWAITING_RECURRING_TO_DATE"
    if (wantsBack) {
        // Sección 17.A — vuelve a AWAITING_RECURRING_FROM_DATE: se re-pide
        // "desde" desde cero (el valor viejo, si lo hubiera, se sobreescribe
        // igual con la próxima respuesta válida, nunca se muestra ni se usa).
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_FROM_DATE", {});
        await reply(WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT, "RECURRING_RANGE_BACK_TO_FROM");
        return { handled: true };
    }

    const normalizedTo = parseWhatsappFunctionCardDateText(text);
    if (!normalizedTo) {
        await reply(WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT, "RECURRING_RANGE_TO_INVALID");
        return { handled: true };
    }
    if (isRecurringToBeforeFrom(pending.partialData.from, normalizedTo)) {
        await reply(WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT, "RECURRING_RANGE_TO_BEFORE_FROM");
        return { handled: true };
    }

    const result = await handleConversationInput(conversationId, { value: { from: pending.partialData.from, to: normalizedTo } });
    if (result?.prompt?.error) {
        // No debería pasar nunca en la práctica (ambas fechas y "hasta >=
        // desde" ya se validaron con los mismos criterios reales antes de
        // llegar acá) — el pending queda intacto, recuperable pidiendo de
        // nuevo sólo la fecha hasta.
        await reply(WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT, "RECURRING_RANGE_COMMIT_ERROR");
        return { handled: true };
    }
    await deletePendingStepInputDep(conversationId);
    await reply(extractWhatsappReplyText(result), "RECURRING_RANGE_COMPLETED");
    return { handled: true };
}

// Fase 3F — step FUNCTIONS_WEEKDAYS (inputType WEEKDAYS): a diferencia de
// RANGE/SCHEDULES, es un intercambio ÚNICO (una selección de días = una
// respuesta), no necesita WhatsappPendingStepInput — sólo traducir el texto
// ("1,3,5") al array 0-6 que exige el motor y llamarlo una vez. Se
// intercepta igual que los demás (nunca se deja pasar el texto crudo:
// weekdays.js#parse exige un Array, un string como "1,3,5" siempre lo
// rechaza sin dar ninguna pista útil al organizador).
async function tryHandleRecurringWeekdaysSubflow({ conversationId, text, reply, handleConversationInput, resumeConversation }) {
    const currentState = await resumeConversation(conversationId);
    if (currentState?.prompt?.stepId !== "FUNCTIONS_WEEKDAYS") {
        return { handled: false, currentState };
    }

    if (isBackCommand(text)) {
        // Sección 18 — BACK real del motor, nunca simula un pending propio
        // (no existe ninguno para este step). Vuelve a FUNCTIONS_RANGE.
        const backResult = await handleConversationInput(conversationId, { action: "BACK" });
        if (backResult?.prompt?.error) {
            await reply(extractWhatsappReplyText(backResult), "RECURRING_WEEKDAYS_BACK_REJECTED");
            return { handled: true };
        }
        await reply(extractWhatsappReplyText(backResult), "RECURRING_WEEKDAYS_BACK_TO_PREVIOUS_STEP");
        return { handled: true };
    }

    const days = parseWhatsappWeekdaySelection(text);
    if (!days) {
        await reply(WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT, "RECURRING_WEEKDAYS_INVALID");
        return { handled: true };
    }

    const result = await handleConversationInput(conversationId, { value: days });
    if (result?.prompt?.error) {
        await reply(WHATSAPP_RECURRING_WEEKDAYS_COMMIT_ERROR_TEXT, "RECURRING_WEEKDAYS_COMMIT_ERROR");
        return { handled: true };
    }

    // Sección 8 — confirmación informativa + la pregunta siguiente en el
    // mismo mensaje, nunca otra confirmación Sí/No.
    await reply(`${buildWhatsappWeekdaysConfirmationText(days)}\n\n${extractWhatsappReplyText(result)}`, "RECURRING_WEEKDAYS_COMPLETED");
    return { handled: true };
}

// Fase 3F — quinto consumidor de WhatsappPendingStepInput: step
// FUNCTIONS_RECURRING_SCHEDULES (inputType TIME_RANGE_LIST) — uno o varios
// horarios, mismo ciclo hora inicio -> hora fin -> ¿agregar otro? que
// FUNCTIONS_LIST (Fase 3E), reutilizando sin duplicar los mismos
// validadores/textos de hora.
//
// IMPORTANTE (hallazgo de auditoría, sección A del informe de entrega):
// FUNCTIONS_RECURRING_SCHEDULES.next() apunta al MISMO step terminal
// FUNCTIONS_LIST que usa MULTIPLE (steps/definitions.js) — y
// generateRecurringSlots corre DENTRO de
// FUNCTIONS_RECURRING_SCHEDULES.setValue, así que en el instante en que el
// motor acepta los horarios, `result.prompt.slots` YA trae las funciones
// concretas generadas (fecha × horario, para cada día del rango que cae en
// alguno de los días elegidos). FUNCTIONS_LIST sigue siendo su propio step
// real con su propio input handler: hace falta confirmarlo con el motor
// para que las persista en `draft.functions` y avance a EVENT_PRICING_TYPE
// — si no, quedarían generadas en el borrador pero nunca guardadas. Por
// eso, al finalizar los horarios, esta función hace DOS llamadas reales al
// motor en cadena (SCHEDULES, y automáticamente FUNCTIONS_LIST con
// `result.prompt.slots` tal cual), nunca recalculando nada: nunca se
// duplica generateRecurringSlots en WhatsApp, sólo se reenvía lo que el
// motor ya generó. Sin este auto-commit, RECURRING obligaría al organizador
// a recargar a mano, función por función, exactamente lo que el modo
// recurrente existe para evitar.
async function tryHandleRecurringSchedulesSubflow({
    conversationId,
    text,
    reply,
    handleConversationInput,
    resumeConversation,
    getPendingStepInput: getPendingStepInputDep,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    const currentState = await resumeConversation(conversationId);
    const isCurrentStepSchedules = currentState?.prompt?.stepId === "FUNCTIONS_RECURRING_SCHEDULES";

    let pending = await getPendingStepInputDep(conversationId);
    if (pending && (pending.stepId !== "FUNCTIONS_RECURRING_SCHEDULES" || !isCurrentStepSchedules)) {
        pending = null;
    }

    if (!isCurrentStepSchedules) {
        return { handled: false, currentState };
    }

    if (!pending) {
        pending = await resetPendingStepInputDep(conversationId, "FUNCTIONS_RECURRING_SCHEDULES", "AWAITING_RECURRING_START_TIME", {
            schedules: [],
            current: {},
        });
    }

    const wantsBack = isBackCommand(text);
    const schedules = pending.partialData?.schedules ?? [];
    const current = pending.partialData?.current ?? {};

    if (pending.status === "AWAITING_RECURRING_START_TIME") {
        if (wantsBack) {
            if (schedules.length > 0) {
                // Sección 19.B — todavía no se escribió nada del horario
                // nuevo: vuelve a la decisión "¿agregar otro?" sin tocar los
                // horarios ya confirmados.
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_ADD_ANOTHER", { schedules, current: {} });
                const lastSchedule = schedules[schedules.length - 1];
                await reply(buildWhatsappScheduleAddedSummaryText(lastSchedule), "RECURRING_SCHEDULES_BACK_TO_ADD_ANOTHER");
                return { handled: true };
            }

            // Sección 19.D — primer horario, ningún sub-paso anterior dentro
            // de este pending: BACK real del motor, vuelve a FUNCTIONS_WEEKDAYS.
            const backResult = await handleConversationInput(conversationId, { action: "BACK" });
            if (backResult?.prompt?.error) {
                await reply(extractWhatsappReplyText(backResult), "RECURRING_SCHEDULES_BACK_REJECTED");
                return { handled: true };
            }
            await deletePendingStepInputDep(conversationId);
            await reply(extractWhatsappReplyText(backResult), "RECURRING_SCHEDULES_BACK_TO_PREVIOUS_STEP");
            return { handled: true };
        }

        const trimmed = typeof text === "string" ? text.trim() : "";
        if (!isValidTimeString(trimmed)) {
            await reply(WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT, "RECURRING_SCHEDULES_START_TIME_INVALID");
            return { handled: true };
        }
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_END_TIME", { schedules, current: { startTime: trimmed } });
        await reply(WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT, "RECURRING_SCHEDULES_END_TIME_PROMPT");
        return { handled: true };
    }

    if (pending.status === "AWAITING_RECURRING_END_TIME") {
        if (wantsBack) {
            // Vuelve a AWAITING_RECURRING_START_TIME: elimina todo el
            // horario en curso (el único campo confirmado hasta acá era
            // `startTime`) — los horarios anteriores no se tocan.
            await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_START_TIME", { schedules, current: {} });
            await reply(buildWhatsappRecurringStartTimePromptText(schedules.length === 0), "RECURRING_SCHEDULES_BACK_TO_START_TIME");
            return { handled: true };
        }

        const trimmedEnd = typeof text === "string" ? text.trim() : "";
        if (!isValidTimeString(trimmedEnd)) {
            await reply(WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT, "RECURRING_SCHEDULES_END_TIME_INVALID");
            return { handled: true };
        }

        const completedSchedule = { startTime: current.startTime, endTime: trimmedEnd };
        const updatedSchedules = [...schedules, completedSchedule];
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_ADD_ANOTHER", { schedules: updatedSchedules, current: {} });
        await reply(buildWhatsappScheduleAddedSummaryText(completedSchedule), "RECURRING_SCHEDULES_SCHEDULE_ADDED");
        return { handled: true };
    }

    // pending.status === "AWAITING_RECURRING_ADD_ANOTHER"
    if (wantsBack) {
        // Sección 19.C — mismo patrón de Fase 3E: corregir el ÚLTIMO
        // horario confirmado, sacándolo temporalmente de `schedules` y
        // cargándolo en `current` para volver a preguntar la hora de fin
        // (de ahí, "volver" sigue encadenando hacia hora de inicio).
        const lastSchedule = schedules[schedules.length - 1];
        const remainingSchedules = schedules.slice(0, -1);
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_END_TIME", {
            schedules: remainingSchedules,
            current: { startTime: lastSchedule.startTime, endTime: lastSchedule.endTime },
        });
        await reply(WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT, "RECURRING_SCHEDULES_EDIT_LAST_SCHEDULE");
        return { handled: true };
    }

    // Reutiliza classifyInitialIntent, igual que Fase 3E.
    const intent = classifyInitialIntent(text);
    if (intent === "AFFIRMATIVE") {
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_RECURRING_START_TIME", { schedules, current: {} });
        await reply(WHATSAPP_RECURRING_START_TIME_NEXT_PROMPT_TEXT, "RECURRING_SCHEDULES_ADD_ANOTHER");
        return { handled: true };
    }
    if (intent === "NEGATIVE") {
        const result = await handleConversationInput(conversationId, { value: schedules });
        if (result?.prompt?.error) {
            // Sección 23 — nunca se borra el pending antes de saber que el
            // motor aceptó: todos los horarios cargados siguen ahí.
            await reply(WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT, "RECURRING_SCHEDULES_COMMIT_ERROR");
            return { handled: true };
        }

        // SCHEDULES aceptado: el pending de este step ya no corresponde a
        // ningún sub-paso pendiente (el step real vigente ya es
        // FUNCTIONS_LIST) — se borra ahora, independientemente de lo que
        // ocurra con el auto-commit de abajo (ver comentario de la función).
        await deletePendingStepInputDep(conversationId);

        const slots = result?.prompt?.slots ?? [];
        if (slots.length === 0) {
            // Sección 25 — el motor lo va a detectar solo (FUNCTIONS_LIST
            // rechaza un array vacío) apenas se reintente: se evita esa
            // llamada innecesaria y se da directamente un mensaje claro y
            // recuperable ("volver" desde acá lo resuelve el sub-flujo de
            // FUNCTIONS_LIST de Fase 3E, sin pending propio en este punto).
            await reply(WHATSAPP_RECURRING_NO_OCCURRENCES_TEXT, "RECURRING_NO_OCCURRENCES");
            return { handled: true };
        }

        // Fase 3G — mismo helper compartido que SINGLE (ver
        // commitPrefilledFunctionsListIfNeeded): confirma `slots` tal cual
        // en FUNCTIONS_LIST, sin recalcular nada.
        const finalResult = await commitPrefilledFunctionsListIfNeeded(conversationId, result, handleConversationInput);
        if (finalResult?.prompt?.error) {
            // No debería pasar nunca en la práctica (los slots ya vienen
            // validados por el propio motor) — mensaje mínimo seguro, sin
            // loop; el organizador puede seguir desde el step real vigente
            // (FUNCTIONS_LIST) con el sub-flujo de Fase 3E.
            await reply(WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT, "RECURRING_FUNCTIONS_LIST_COMMIT_ERROR");
            return { handled: true };
        }
        await reply(extractWhatsappReplyText(finalResult), "RECURRING_COMPLETED");
        return { handled: true };
    }

    await reply(WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT, "RECURRING_SCHEDULES_ADD_ANOTHER_INVALID");
    return { handled: true };
}

// Fase 3G, secciones 2/3/5 — steps YES_NO genéricos (WANTS_FREE_TICKETS,
// PROMO_VIDEO_ASK "YouTube", SOCIAL_LINKS_ASK "redes sociales",
// ADD_ANOTHER_SOCIAL, ver steps/definitions.js): intercambio ÚNICO, igual
// que tryHandleRecurringWeekdaysSubflow — no necesita WhatsappPendingStepInput.
// Traduce "1"/"2" a `true`/`false` (resolveWhatsappYesNoReply) ANTES de
// llamar al motor; si la respuesta no es "1" ni "2", se deja pasar el texto
// crudo tal cual (inputHandlers/yesNo.js ya entiende "sí"/"no"/etc. — nunca
// se reimplementa esa validación acá).
async function tryHandleYesNoSubflow({ conversationId, text, reply, handleConversationInput, resumeConversation }) {
    const currentState = await resumeConversation(conversationId);
    if (currentState?.prompt?.inputType !== "YES_NO") {
        return { handled: false, currentState };
    }

    if (isBackCommand(text)) {
        // Mismo BACK real del motor ya auditado y usado en los demás
        // sub-flujos — ningún YES_NO tiene sub-estado propio al cual volver.
        const backResult = await handleConversationInput(conversationId, { action: "BACK" });
        if (backResult?.prompt?.error) {
            await reply(extractWhatsappReplyText(backResult), "YES_NO_BACK_REJECTED");
            return { handled: true };
        }
        await reply(extractWhatsappReplyText(backResult), "YES_NO_BACK_TO_PREVIOUS_STEP");
        return { handled: true };
    }

    const mapped = resolveWhatsappYesNoReply(text);
    const result = await handleConversationInput(conversationId, { value: mapped === null ? text : mapped });
    await reply(extractWhatsappReplyText(result), "YES_NO_ANSWERED");
    return { handled: true };
}

// Fase 3G, sección 7 — step PREVIEW: reemplaza el error "Elegí PUBLISH,
// DRAFT o EDIT" (nunca debe llegar texto crudo al motor acá) por un menú
// numerado 1/2/3, mapeado a las acciones REALES que ya entiende
// EventCreationEngine.handlePreviewInput/handleBack — nunca se inventa
// semántica nueva. Sin WhatsappPendingStepInput: es una decisión de una
// sola respuesta, igual que YES_NO/WEEKDAYS.
async function tryHandlePreviewSubflow({ conversationId, text, reply, handleConversationInput, resumeConversation }) {
    const currentState = await resumeConversation(conversationId);
    if (currentState?.prompt?.stepId !== "PREVIEW") {
        return { handled: false, currentState };
    }

    // "volver"/"3" son equivalentes: ambos usan el BACK real del motor
    // (nunca EDIT con un stepId inventado — no hay editor de secciones por
    // WhatsApp en esta fase).
    if (isBackCommand(text) || resolveWhatsappPreviewChoice(text) === "BACK") {
        const result = await handleConversationInput(conversationId, { action: "BACK" });
        await reply(extractWhatsappReplyText(result), "PREVIEW_BACK");
        return { handled: true };
    }

    const choice = resolveWhatsappPreviewChoice(text);
    if (!choice) {
        await reply(WHATSAPP_PREVIEW_INVALID_TEXT, "PREVIEW_INVALID");
        return { handled: true };
    }

    // choice === "PUBLISH" | "DRAFT" — EventServicePort.commit ya hace todo
    // lo real (crear el evento, links, agenda, entradas y, si PUBLISH,
    // marcarlo PUBLISHED); acá sólo se traduce la elección numerada del
    // organizador a la acción que el motor ya entiende. Un rechazo
    // conversacional (translateEventServiceError) nunca se pierde: vuelve
    // como prompt.error sobre el mismo PREVIEW, con el resumen completo de
    // nuevo (ver extractWhatsappReplyText#prompt.type==="PREVIEW") — la
    // conversación sigue intacta, nunca se borra nada acá.
    const result = await handleConversationInput(conversationId, { action: choice });
    await reply(extractWhatsappReplyText(result), choice === "PUBLISH" ? "PREVIEW_PUBLISH" : "PREVIEW_DRAFT");
    return { handled: true };
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
        getPendingStepInput: getPendingStepInputDep = getPendingStepInput,
        resetPendingStepInput: resetPendingStepInputDep = resetPendingStepInput,
        updatePendingStepInputStatus: updatePendingStepInputStatusDep = updatePendingStepInputStatus,
        deletePendingStepInput: deletePendingStepInputDep = deletePendingStepInput,
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
    // Bug fix (ubicación por WhatsApp Location): mismo criterio aditivo que
    // isProcessableImage — un mensaje type==="location" también queda
    // descartado por shouldAutoReply si no se lo deja pasar explícito acá.
    const isProcessableLocation = message?.type === "location" && Boolean(message.location);
    if (!shouldAutoReply(message) && !isProcessableImage && !isProcessableLocation) return;

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

        // Fase 3D — mensaje type==="location": sólo tiene sentido procesarlo
        // si hay conversación activa. tryHandleLocationSubflow decide todo
        // lo demás (incluido si el step real es LOCATION o no); si no lo
        // es, devuelve {handled:false} y se avisa "no necesito ubicación
        // acá" con el prompt vigente, igual que antes.
        if (isProcessableLocation) {
            if (!active) return;

            const locationResult = await tryHandleLocationSubflow({
                conversationId: active.id,
                message,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
                getPendingStepInput: getPendingStepInputDep,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (locationResult.handled) return;

            await reply(
                `${WHATSAPP_LOCATION_NOT_EXPECTED_TEXT}\n\n${extractWhatsappReplyText(locationResult.currentState)}`,
                "LOCATION_NOT_EXPECTED"
            );
            return;
        }

        if (active) {
            if (isCancelCommand(text)) {
                await cancelConversation(active.id, active.userId);
                await reply(WHATSAPP_CANCEL_TEXT, "CANCEL");
                return;
            }

            // Fase 3D — LOCATION ("cómo cargar la ubicación") se intercepta
            // ACÁ, ANTES de tocar el motor, igual que FUNCTIONS_SINGLE_CARD:
            // un mensaje de texto (elección de método 1/2, calle, altura,
            // ciudad, provincia, "volver") nunca debe llegar crudo a
            // handleConversationInput. Ver tryHandleLocationSubflow.
            const locationResult = await tryHandleLocationSubflow({
                conversationId: active.id,
                message,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
                getPendingStepInput: getPendingStepInputDep,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (locationResult.handled) return;

            // Fase 3C — FUNCTIONS_SINGLE_CARD ("una sola función") se
            // intercepta ACÁ, ANTES de tocar el motor: a diferencia de
            // SINGLE_SELECT (donde el primer intento con texto crudo es
            // inofensivo y útil), un mensaje suelto de fecha/hora nunca debe
            // llegar a handleConversationInput — el motor sólo puede recibir
            // los 3 datos juntos, al final. Ver tryHandleFunctionCardSubflow.
            const functionCardResult = await tryHandleFunctionCardSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
                getPendingStepInput: getPendingStepInputDep,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (functionCardResult.handled) return;

            // Fase 3E — FUNCTIONS_LIST ("varias funciones") se intercepta
            // ACÁ, mismo criterio que FUNCTIONS_SINGLE_CARD/LOCATION: el
            // motor sólo puede recibir el array completo de funciones, y
            // sólo al finalizar el ciclo. Ver tryHandleFunctionsListSubflow.
            const functionsListResult = await tryHandleFunctionsListSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
                getPendingStepInput: getPendingStepInputDep,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (functionsListResult.handled) return;

            // Fase 3F — RECURRING: tres steps reales distintos (rango, días,
            // horarios), cada uno interceptado ANTES del motor con el mismo
            // criterio que los sub-flujos anteriores.
            const recurringRangeResult = await tryHandleRecurringRangeSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
                getPendingStepInput: getPendingStepInputDep,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (recurringRangeResult.handled) return;

            const recurringWeekdaysResult = await tryHandleRecurringWeekdaysSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
            });
            if (recurringWeekdaysResult.handled) return;

            const recurringSchedulesResult = await tryHandleRecurringSchedulesSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
                getPendingStepInput: getPendingStepInputDep,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (recurringSchedulesResult.handled) return;

            // Fase 3G — steps YES_NO (WANTS_FREE_TICKETS/PROMO_VIDEO_ASK/
            // SOCIAL_LINKS_ASK/ADD_ANOTHER_SOCIAL) y PREVIEW (resumen final +
            // PUBLICAR/BORRADOR/VOLVER), mismo criterio que los sub-flujos
            // anteriores: se interceptan ANTES del motor.
            const yesNoResult = await tryHandleYesNoSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
            });
            if (yesNoResult.handled) return;

            const previewResult = await tryHandlePreviewSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                resumeConversation,
            });
            if (previewResult.handled) return;

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
