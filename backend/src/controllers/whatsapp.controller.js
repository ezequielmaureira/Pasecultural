import { logger } from "../logging/logger.js";
import {
    evaluateWebhookVerification,
    getWhatsappVerifyToken,
    isWhatsappTestModeEnabled,
    normalizeWhatsappOutboundRecipient,
    parseInboundWhatsappMessages,
    sendWhatsappTextMessage,
    shouldAutoReply,
} from "../services/whatsapp.service.js";
import { getWhatsappAppSecret, verifyWhatsappWebhookSignature } from "../config/whatsappWebhookSignature.js";
import { parseOrganizationPhoneConfirmationMessage, confirmOrganizationPhoneFromWebhook } from "../services/organizationPhoneVerification.service.js";
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
    clearPendingOrganizationSelection,
    resolveOrganizationOwner,
} from "../services/whatsappOrganizerDiscovery.service.js";
import {
    classifyInitialIntent,
    isCancelCommand,
    isBackCommand,
    extractWhatsappReplyText,
    resolveSingleSelectIndexReply,
    isArgentineDateInThePast,
    resolvePersonFirstName,
    buildGenericPublishIntentGreetingText,
    WHATSAPP_DECLINE_TEXT,
    WHATSAPP_CANCEL_TEXT,
    WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT,
    WHATSAPP_SELECTION_INVALID_TEXT,
    WHATSAPP_IMAGE_NOT_EXPECTED_TEXT,
    WHATSAPP_IMAGE_REQUIRED_TEXT,
    WHATSAPP_LOCATION_NOT_EXPECTED_TEXT,
    WHATSAPP_LOCATION_INSUFFICIENT_TEXT,
    WHATSAPP_LOCATION_METHOD_PROMPT_TEXT,
    WHATSAPP_LOCATION_METHOD_INVALID_TEXT,
    WHATSAPP_LOCATION_SHARE_PROMPT_TEXT,
    WHATSAPP_LOCATION_SHARE_RETRY_TEXT,
    WHATSAPP_LOCATION_MANUAL_ADDRESS_PROMPT_TEXT,
    WHATSAPP_LOCATION_COMMIT_ERROR_TEXT,
    buildWhatsappCompactAddressInvalidText,
    parseWhatsappCompactAddressText,
    buildWhatsappLocationReuseInvalidText,
    buildKnownOrganizationGreetingText,
    buildOrganizationSelectorText,
    buildWhatsappImageUploadErrorText,
    buildLocationInputFromWhatsapp,
    isPublishableWhatsappLocation,
    buildWhatsappFunctionsListDatePromptText,
    buildWhatsappFunctionAddedSummaryText,
    WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT,
    WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT,
    isRecurringToBeforeFrom,
    WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT,
    WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_COMMIT_ERROR_TEXT,
    parseWhatsappWeekdaySelection,
    buildWhatsappWeekdaysConfirmationText,
    buildWhatsappRecurringStartTimePromptText,
    WHATSAPP_RECURRING_SCHEDULE_NEXT_PROMPT_TEXT,
    buildWhatsappScheduleAddedSummaryText,
    WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_NO_OCCURRENCES_TEXT,
    resolveWhatsappYesNoReply,
    resolveWhatsappPreviewChoice,
    WHATSAPP_PREVIEW_INVALID_TEXT,
    buildWhatsappLocationConfirmationText,
    parseWhatsappCompactDateTimeText,
    buildWhatsappCompactDateTimeInvalidText,
    WHATSAPP_COMPACT_DATE_TIME_PAST_TEXT,
    WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT,
    parseWhatsappCompactDateRangeText,
    buildWhatsappCompactDateRangeInvalidText,
    WHATSAPP_COMPACT_DATE_RANGE_PAST_TEXT,
    parseWhatsappCompactTimeRangeText,
    buildWhatsappCompactTimeRangeInvalidText,
    parseWhatsappTicketComboText,
    resolveWhatsappTicketNameOptionId,
    buildWhatsappTicketComboInvalidText,
} from "../services/whatsappOrganizerBot.service.js";
import { uploadWhatsappImageMessage } from "../services/whatsappMediaUpload.service.js";
import {
    getPendingStepInput,
    resetPendingStepInput,
    updatePendingStepInputStatus,
    deletePendingStepInput,
} from "../services/whatsappPendingStepInput.service.js";
import { startWhatsappPerfTimer, enterWithActiveTimer } from "../utils/whatsappPerf.js";
import { enterWithConversationStateRequestCache } from "../conversation/conversationStateRequestCache.js";
import {
    claimInboundMessage,
    completeInboundMessageClaim,
    failInboundMessageClaim,
} from "../services/whatsappInboundMessageClaim.service.js";

// El valor real de ConversationChannel para este canal (ver
// prisma/schema.prisma `enum ConversationChannel { WEB WHATSAPP }`, ya usado
// tal cual por conversation.controller.js para "WEB") — no se inventa un
// literal nuevo.
const WHATSAPP_CHANNEL = "WHATSAPP";

// Fase CIERRE (idempotencia) — a diferencia de TODAS las demás dependencias
// inyectables de processInboundMessage (que por default resuelven a su
// implementación real, ver la firma de la función más abajo), estas tres
// NUNCA deben tocar Prisma por default: hay más de una decena de archivos
// de test de este controller (whatsapp.*.controller.test.js) que mockean
// cada dependencia que efectivamente ejercitan, pero ninguno conoce esta
// fase — si el default fuera el servicio real, CUALQUIERA de esos tests
// dispararía una escritura Prisma real sin darse cuenta. Por eso el default
// acá es un no-op inerte, y el servicio real (importado abajo) se cablea
// EXPLÍCITAMENTE una sola vez, en el único punto de entrada de producción
// real (ver receiveWhatsappWebhook, al final de este archivo) — exactamente
// el mismo patrón de "nunca un default que toque Prisma por accidente" que
// ya protege el resto del proyecto (ver tests/helpers/dbGuard.js).
async function noopClaimInboundMessage() {
    return { claimed: true };
}
async function noopCompleteInboundMessageClaim() {}
async function noopFailInboundMessageClaim() {}

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
// Fase 3H — `perf` (opcional, ver utils/whatsappPerf.js) mide acá adentro
// las dos únicas fases que faltaban: BUILD_REPLY (todo lo que pasó desde la
// última marca del caller hasta que se llamó a sendBotReply — incluye
// extractWhatsappReplyText, que es CPU pura) y META_SEND (la llamada HTTP
// real a Graph API, el único costo EXTERNO de esta función). Es también el
// único punto que ya centralizaba TODOS los envíos de processInboundMessage
// (ver comentario original más abajo), así que agregar el timing acá cubre
// automáticamente las ~15 ramas de retorno de esa función sin tocar cada
// una — nunca se llama a logger/perf si WHATSAPP_PERF_LOG no está activo
// (ver isWhatsappPerfLogEnabled).
//
// Bug fix (saludos espontáneos) — diagnóstico mínimo agregado en ESTE único
// punto: es el único lugar de todo el proyecto que efectivamente manda un
// mensaje de respuesta del bot (ver la auditoría del informe de entrega —
// los ~15 `reply(...)` de processInboundMessage son los únicos callers).
// `source: "INBOUND_MESSAGE"` es un literal fijo, nunca calculado: hace
// EXPLÍCITA en el log la causalidad que hoy ya es cierta por construcción
// (sendBotReply sólo existe dentro de processInboundMessage, que sólo se
// invoca desde receiveWhatsappWebhook con un `message` real) — si en el
// futuro apareciera otro caller que NO tenga un inboundMessageId real, esa
// diferencia va a quedar visible acá en vez de asumida. `context` es
// opcional y sólo lo usan los call sites que ya tienen ese dato a mano
// (hoy, el saludo — ver GREETING más abajo, organizationId cuando aplica);
// nunca obliga a tocar los demás ~13 call sites de `reply(...)`.
function redactWaId(waId) {
    if (typeof waId !== "string" || waId.length < 6) return "***";
    return `${waId.slice(0, 4)}***${waId.slice(-2)}`;
}

async function sendBotReply({ sendText, to, from, messageId, text, engineAction, perf, conversationId, context = {} }) {
    perf?.mark("BUILD_REPLY");
    if (!text) {
        perf?.finish({ conversationId, engineAction, sent: false });
        return;
    }
    const result = await sendText({ to, text });
    perf?.mark("META_SEND");
    const recipientNormalized = to !== from;
    // Nunca el texto/teléfono completo/token — sólo lo necesario para
    // diagnosticar en desarrollo (ver sección 12 del pedido de Fase 2E, y la
    // sección "diagnóstico" del bug fix de saludos espontáneos).
    const diagnosticFields = {
        source: "INBOUND_MESSAGE",
        inboundMessageId: messageId,
        to: redactWaId(to),
        engineAction,
        conversationId,
        recipientNormalized,
        ...context,
    };
    if (!result.success) {
        logger.warn("WhatsApp organizer bot: Meta rechazó el envío", { ...diagnosticFields, success: false, error: result.error });
        perf?.finish({ conversationId, engineAction, success: false });
        return;
    }
    logger.info("WhatsApp organizer bot reply sent", { ...diagnosticFields, success: true, outboundMessageId: result.messageId });
    perf?.finish({ conversationId, engineAction, success: true });
}

// Fase 3H — los steps que consumen WhatsappPendingStepInput son los ÚNICOS
// que necesitan acumular datos ENTRE mensajes (una lista que crece, o un
// sub-flujo de varios pasos) — para cualquier otro step real, ese pending
// nunca se mira, así que ni vale la pena leerlo. Lista literal (no
// derivada de otro lugar) para no acoplar esta optimización de
// performance a ningún detalle interno de definitions.js — si el día de
// mañana un step nuevo empieza a usar WhatsappPendingStepInput, agregarlo
// acá es la señal explícita de que también hay que agregarlo.
//
// Fase 3K — FUNCTIONS_SINGLE_CARD y FUNCTIONS_RANGE salieron de esta lista:
// al compactarse a un único mensaje (fecha+horario / desde+hasta, ver
// parseWhatsappCompactDateTimeText/parseWhatsappCompactDateRangeText) ya
// no hay ningún sub-paso intermedio que recordar entre mensajes, así que
// dejaron de necesitar WhatsappPendingStepInput por completo.
const PENDING_STEP_INPUT_STEP_IDS = new Set(["LOCATION", "FUNCTIONS_LIST", "FUNCTIONS_RECURRING_SCHEDULES"]);

function isPendingStepInputStep(currentState) {
    return PENDING_STEP_INPUT_STEP_IDS.has(currentState?.prompt?.stepId);
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

// Fase 3K, sección 9 — el ÚNICO momento en que el motor recién avanza a
// LOCATION (nunca durante el sub-flujo en sí, que corre enteramente en
// tryHandleLocationSubflow) es justo después de que se confirma la imagen
// de portada (COVER_IMAGE.next() siempre es "LOCATION", ver
// steps/definitions.js) — ver el call site de abajo, en la rama de imagen.
//
// Fix (dejar de sugerir direcciones de eventos anteriores) — antes existía
// una función intermedia (replyForEngineResult) que, justo en ese momento,
// consultaba si la Organization tenía una dirección usable en un evento
// anterior (Event.findFirst, ver whatsappOrganizationLocation.service.js) y
// ofrecía reutilizarla en lugar del selector de método. Eso quedó
// eliminado por completo: ya no hace falta ninguna lógica especial acá —
// extractWhatsappReplyText (whatsappOrganizerBot.service.js) YA devuelve
// directo el selector de método (WHATSAPP_LOCATION_METHOD_PROMPT_TEXT —
// "1. Compartir ubicación / 2. Completar dirección manualmente") para
// cualquier resultado del motor cuyo step sea LOCATION, sin ningún dato
// precargado; el pending correspondiente (AWAITING_LOCATION_METHOD, vacío)
// lo sigue creando tryHandleLocationSubflow recién con el próximo mensaje,
// exactamente como ya hacía antes de que existiera la sugerencia de
// reutilización.
//
// Compatibilidad — el status AWAITING_REUSE_CONFIRMATION y sus textos
// (buildWhatsappLocationReusePromptText/buildWhatsappLocationReuseInvalidText)
// ya no se EMITEN, pero tryHandleLocationSubflow todavía sabe procesarlo
// (ver más abajo): una conversación vieja cuyo WhatsappPendingStepInput ya
// haya quedado en ese status (creado por una versión anterior de este
// código, antes de este fix) sigue pudiendo responder "1"/"2"/"volver" con
// normalidad, sin quedar trabada.

// Fase 3K — colapsa fecha + hora de inicio + hora de fin en UN solo
// mensaje ("26/08, 20:00-22:00", ver parseWhatsappCompactDateTimeText) en
// vez de 3 preguntas separadas. El motor sigue recibiendo exactamente el
// mismo objeto {date,startTime,endTime} en una sola llamada
// (inputHandlers/functionCard.js no cambia) — sólo cambia CUÁNTOS mensajes
// de WhatsApp hacen falta para armarlo. Como ahora es un intercambio único
// (nunca hay un sub-paso intermedio que recordar entre mensajes), este
// step YA NO NECESITA WhatsappPendingStepInput — se sacó de
// PENDING_STEP_INPUT_STEP_IDS más arriba.
async function tryHandleFunctionCardSubflow({ conversationId, text, reply, handleConversationInput, currentState }) {
    if (currentState?.prompt?.stepId !== "FUNCTIONS_SINGLE_CARD") {
        return { handled: false };
    }

    if (isBackCommand(text)) {
        // Único sub-paso de este step: "volver" es directamente el BACK
        // real del motor (mismo mecanismo auditado y ya usado en el resto
        // de los sub-flujos), vuelve a FUNCTIONS_MODE.
        const backResult = await handleConversationInput(conversationId, { action: "BACK" });
        await reply(extractWhatsappReplyText(backResult), "FUNCTION_CARD_BACK_TO_PREVIOUS_STEP");
        return { handled: true };
    }

    const parsed = parseWhatsappCompactDateTimeText(text);
    if (!parsed) {
        await reply(buildWhatsappCompactDateTimeInvalidText(), "FUNCTION_CARD_DATE_TIME_INVALID");
        return { handled: true };
    }
    if (isArgentineDateInThePast(parsed.date)) {
        await reply(WHATSAPP_COMPACT_DATE_TIME_PAST_TEXT, "FUNCTION_CARD_DATE_PAST");
        return { handled: true };
    }

    const result = await handleConversationInput(conversationId, { value: parsed });
    if (result?.prompt?.error) {
        // No debería pasar nunca en la práctica (fecha y horarios ya se
        // validaron con los mismos validadores reales del motor antes de
        // llegar acá) — comportamiento mínimo seguro: se pide reintentar el
        // mensaje completo (ya no hay "sólo la hora de fin" que recuperar,
        // el intercambio es atómico).
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
        // construcción).
        await reply(WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT, "FUNCTION_CARD_COMMIT_ERROR");
        return { handled: true };
    }

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
    currentState,
    pending: rawPending,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    // Fase 3D — mismo chequeo reforzado que tryHandleFunctionCardSubflow:
    // el step REAL vigente (nunca el stepId grabado en el pending) es la
    // única fuente de verdad de si este pending sigue siendo válido —
    // necesario ahora que hay DOS steps distintos consumiendo
    // WhatsappPendingStepInput.
    //
    // Fase 3H — `currentState`/`pending` resueltos UNA sola vez por el
    // caller (ver comentario equivalente en tryHandleFunctionCardSubflow).
    const isCurrentStepLocation = currentState?.prompt?.stepId === "LOCATION";

    let pending = rawPending;
    if (pending && (pending.stepId !== "LOCATION" || !isCurrentStepLocation)) {
        pending = null;
    }

    if (!isCurrentStepLocation) {
        return { handled: false };
    }

    if (!pending) {
        // El prompt ya se mostró al llegar a este step — ver
        // maybeOfferLocationReuse, que decide (antes de este punto, en el
        // momento en que el motor recién avanzó a LOCATION) si ese primer
        // mensaje fue el de reutilizar la última ubicación de la
        // Organization o el de método — y crea el pending correspondiente.
        // Si por lo que sea llegamos hasta acá sin pending (no debería
        // pasar en el uso normal), se asume el camino de siempre.
        pending = await resetPendingStepInputDep(conversationId, "LOCATION", "AWAITING_LOCATION_METHOD");
    }

    const wantsBack = message.type === "text" && isBackCommand(text);

    if (pending.status === "AWAITING_REUSE_CONFIRMATION") {
        if (wantsBack) {
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
                const result = await handleConversationInput(conversationId, { value: pending.partialData.location });
                if (result?.prompt?.error) {
                    await reply(WHATSAPP_LOCATION_COMMIT_ERROR_TEXT, "LOCATION_COMMIT_ERROR");
                    return { handled: true };
                }
                await deletePendingStepInputDep(conversationId);
                await reply(extractWhatsappReplyText(result), "LOCATION_REUSE_CONFIRMED");
                return { handled: true };
            }
            if (choice === "2") {
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_LOCATION_METHOD", {});
                await reply(WHATSAPP_LOCATION_METHOD_PROMPT_TEXT, "LOCATION_METHOD_PROMPT");
                return { handled: true };
            }
        }
        await reply(buildWhatsappLocationReuseInvalidText(pending.partialData.location), "LOCATION_REUSE_INVALID");
        return { handled: true };
    }

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
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_MANUAL_ADDRESS", {});
                await reply(WHATSAPP_LOCATION_MANUAL_ADDRESS_PROMPT_TEXT, "LOCATION_MANUAL_ADDRESS_PROMPT");
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

    // Fase 3K — dirección manual COMPLETA en un solo mensaje ("San Martín
    // 850, General Roca, Río Negro", ver parseWhatsappCompactAddressText)
    // en vez de 4 preguntas separadas. Sólo el texto tiene sentido acá.
    // assertPublishable (event.service.js) exige venueName + dirección —
    // EventServicePort#buildLocationInput ya deriva venueName = address
    // cuando no hay nombre de lugar (misma convención que el modo manual
    // sin mapa de la Web), así que `venueName: null` alcanza. El geocoding
    // server-side (geocoding.service.js) corre después, solo, al confirmar
    // el evento — este sub-flujo nunca lo llama directamente.
    if (pending.status === "AWAITING_MANUAL_ADDRESS") {
        if (wantsBack) {
            await resetPendingStepInputDep(conversationId, "LOCATION", "AWAITING_LOCATION_METHOD");
            await reply(WHATSAPP_LOCATION_METHOD_PROMPT_TEXT, "LOCATION_METHOD_PROMPT");
            return { handled: true };
        }

        const location = message.type === "text" ? parseWhatsappCompactAddressText(text) : null;
        if (!location) {
            await reply(buildWhatsappCompactAddressInvalidText(), "LOCATION_MANUAL_ADDRESS_INVALID");
            return { handled: true };
        }

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
    currentState,
    pending: rawPending,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    // Fase 3D/3E — mismo chequeo reforzado que los otros dos sub-flujos: el
    // step REAL vigente (nunca el stepId grabado en el pending) es la única
    // fuente de verdad de si este pending sigue siendo válido — ahora con
    // TRES steps distintos consumiendo WhatsappPendingStepInput.
    //
    // Fase 3H — `currentState`/`pending` resueltos UNA sola vez por el
    // caller (ver comentario equivalente en tryHandleFunctionCardSubflow).
    const isCurrentStepFunctionsList = currentState?.prompt?.stepId === "FUNCTIONS_LIST";

    let pending = rawPending;
    if (pending && (pending.stepId !== "FUNCTIONS_LIST" || !isCurrentStepFunctionsList)) {
        pending = null;
    }

    if (!isCurrentStepFunctionsList) {
        return { handled: false };
    }

    if (!pending) {
        // El prompt de "primera función" ya se mostró al llegar a este step
        // (ver extractWhatsappReplyText#inputType==="FUNCTIONS_LIST") — el
        // `text` que acaba de llegar ES la respuesta a esa pregunta.
        pending = await resetPendingStepInputDep(conversationId, "FUNCTIONS_LIST", "AWAITING_DATE_TIME", { functions: [] });
    }

    const wantsBack = isBackCommand(text);
    const functions = pending.partialData?.functions ?? [];

    // Fase 3K — cada función se colecta en UN mensaje (fecha+horario, ver
    // parseWhatsappCompactDateTimeText) en vez de 3 preguntas separadas:
    // este sub-flujo pasa de 4 sub-estados a sólo 2 (cargar la próxima
    // función / decidir si agregar otra).
    if (pending.status === "AWAITING_DATE_TIME") {
        if (wantsBack) {
            if (functions.length > 0) {
                // Todavía no se escribió nada de esta función nueva: volver
                // conceptualmente a la decisión posterior a la función
                // anterior, sin tocar las ya confirmadas.
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_ADD_ANOTHER", { functions });
                const lastFn = functions[functions.length - 1];
                await reply(buildWhatsappFunctionAddedSummaryText(lastFn), "FUNCTIONS_LIST_BACK_TO_ADD_ANOTHER");
                return { handled: true };
            }

            // Primera función, ningún sub-paso anterior dentro de este
            // pending al cual volver: mismo BACK real del motor ya
            // auditado y usado en el resto de los sub-flujos.
            const backResult = await handleConversationInput(conversationId, { action: "BACK" });
            if (backResult?.prompt?.error) {
                await reply(extractWhatsappReplyText(backResult), "FUNCTIONS_LIST_BACK_REJECTED");
                return { handled: true };
            }
            await deletePendingStepInputDep(conversationId);
            await reply(extractWhatsappReplyText(backResult), "FUNCTIONS_LIST_BACK_TO_PREVIOUS_STEP");
            return { handled: true };
        }

        const parsed = parseWhatsappCompactDateTimeText(text);
        if (!parsed) {
            await reply(buildWhatsappCompactDateTimeInvalidText(), "FUNCTIONS_LIST_DATE_TIME_INVALID");
            return { handled: true };
        }
        if (isArgentineDateInThePast(parsed.date)) {
            await reply(WHATSAPP_COMPACT_DATE_TIME_PAST_TEXT, "FUNCTIONS_LIST_DATE_PAST");
            return { handled: true };
        }

        const updatedFunctions = [...functions, parsed];
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_ADD_ANOTHER", { functions: updatedFunctions });
        await reply(buildWhatsappFunctionAddedSummaryText(parsed), "FUNCTIONS_LIST_FUNCTION_ADDED");
        return { handled: true };
    }

    // pending.status === "AWAITING_ADD_ANOTHER"
    if (wantsBack) {
        // Corregir la ÚLTIMA función agregada: se descarta y se vuelve a
        // pedir el mensaje compacto completo (ya no hay sub-pasos
        // parciales que restaurar — un solo mensaje reemplaza al anterior).
        const remainingFunctions = functions.slice(0, -1);
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_DATE_TIME", { functions: remainingFunctions });
        await reply(buildWhatsappFunctionsListDatePromptText(remainingFunctions.length === 0), "FUNCTIONS_LIST_EDIT_LAST_FUNCTION");
        return { handled: true };
    }

    // Reutiliza classifyInitialIntent (ya acepta "1"/"2" y, adicionalmente,
    // "sí"/"si"/"no" — sección 9 del pedido) en vez de reimplementar otro
    // clasificador Sí/No.
    const intent = classifyInitialIntent(text);
    if (intent === "AFFIRMATIVE") {
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_DATE_TIME", { functions });
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

// Fase 3K — colapsa "desde"+"hasta" en un solo mensaje ("01/09 al 30/09",
// ver parseWhatsappCompactDateRangeText) en vez de 2 preguntas separadas.
// Al ser ahora un intercambio único, este step YA NO NECESITA
// WhatsappPendingStepInput (mismo criterio que FUNCTIONS_SINGLE_CARD, ver
// PENDING_STEP_INPUT_STEP_IDS más arriba). El motor sigue recibiendo
// exactamente {from,to} en una sola llamada (inputHandlers/dateRange.js no
// cambia).
async function tryHandleRecurringRangeSubflow({ conversationId, text, reply, handleConversationInput, currentState }) {
    if (currentState?.prompt?.stepId !== "FUNCTIONS_RANGE") {
        return { handled: false };
    }

    if (isBackCommand(text)) {
        // Único sub-paso de este step: "volver" es directamente el BACK
        // real del motor, vuelve a FUNCTIONS_MODE.
        const backResult = await handleConversationInput(conversationId, { action: "BACK" });
        await reply(extractWhatsappReplyText(backResult), "RECURRING_RANGE_BACK_TO_PREVIOUS_STEP");
        return { handled: true };
    }

    const parsed = parseWhatsappCompactDateRangeText(text);
    if (!parsed) {
        await reply(buildWhatsappCompactDateRangeInvalidText(), "RECURRING_RANGE_INVALID");
        return { handled: true };
    }
    if (isArgentineDateInThePast(parsed.from)) {
        await reply(WHATSAPP_COMPACT_DATE_RANGE_PAST_TEXT, "RECURRING_RANGE_FROM_PAST");
        return { handled: true };
    }
    if (isRecurringToBeforeFrom(parsed.from, parsed.to)) {
        await reply(WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT, "RECURRING_RANGE_TO_BEFORE_FROM");
        return { handled: true };
    }

    const result = await handleConversationInput(conversationId, { value: parsed });
    if (result?.prompt?.error) {
        // No debería pasar nunca en la práctica (ambas fechas y "hasta >=
        // desde" ya se validaron con los mismos criterios reales antes de
        // llegar acá).
        await reply(WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT, "RECURRING_RANGE_COMMIT_ERROR");
        return { handled: true };
    }
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
// Fase 3H — `currentState` resuelto UNA sola vez por el caller (ver
// comentario equivalente en tryHandleFunctionCardSubflow).
async function tryHandleRecurringWeekdaysSubflow({ conversationId, text, reply, handleConversationInput, currentState }) {
    if (currentState?.prompt?.stepId !== "FUNCTIONS_WEEKDAYS") {
        return { handled: false };
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
    currentState,
    pending: rawPending,
    resetPendingStepInput: resetPendingStepInputDep,
    updatePendingStepInputStatus: updatePendingStepInputStatusDep,
    deletePendingStepInput: deletePendingStepInputDep,
}) {
    // Fase 3H — `currentState`/`pending` resueltos UNA sola vez por el
    // caller (ver comentario equivalente en tryHandleFunctionCardSubflow).
    const isCurrentStepSchedules = currentState?.prompt?.stepId === "FUNCTIONS_RECURRING_SCHEDULES";

    let pending = rawPending;
    if (pending && (pending.stepId !== "FUNCTIONS_RECURRING_SCHEDULES" || !isCurrentStepSchedules)) {
        pending = null;
    }

    if (!isCurrentStepSchedules) {
        return { handled: false };
    }

    if (!pending) {
        pending = await resetPendingStepInputDep(conversationId, "FUNCTIONS_RECURRING_SCHEDULES", "AWAITING_TIME_RANGE", { schedules: [] });
    }

    const wantsBack = isBackCommand(text);
    const schedules = pending.partialData?.schedules ?? [];

    // Fase 3K — cada horario se colecta en UN mensaje ("20:00-22:00", ver
    // parseWhatsappCompactTimeRangeText) en vez de 2 preguntas separadas:
    // este sub-flujo pasa de 3 sub-estados a sólo 2.
    if (pending.status === "AWAITING_TIME_RANGE") {
        if (wantsBack) {
            if (schedules.length > 0) {
                // Todavía no se escribió nada del horario nuevo: vuelve a
                // la decisión "¿agregar otro?" sin tocar los ya confirmados.
                await updatePendingStepInputStatusDep(conversationId, "AWAITING_ADD_ANOTHER", { schedules });
                const lastSchedule = schedules[schedules.length - 1];
                await reply(buildWhatsappScheduleAddedSummaryText(lastSchedule), "RECURRING_SCHEDULES_BACK_TO_ADD_ANOTHER");
                return { handled: true };
            }

            // Primer horario, ningún sub-paso anterior dentro de este
            // pending: BACK real del motor, vuelve a FUNCTIONS_WEEKDAYS.
            const backResult = await handleConversationInput(conversationId, { action: "BACK" });
            if (backResult?.prompt?.error) {
                await reply(extractWhatsappReplyText(backResult), "RECURRING_SCHEDULES_BACK_REJECTED");
                return { handled: true };
            }
            await deletePendingStepInputDep(conversationId);
            await reply(extractWhatsappReplyText(backResult), "RECURRING_SCHEDULES_BACK_TO_PREVIOUS_STEP");
            return { handled: true };
        }

        const parsed = parseWhatsappCompactTimeRangeText(text);
        if (!parsed) {
            await reply(buildWhatsappCompactTimeRangeInvalidText(), "RECURRING_SCHEDULES_TIME_RANGE_INVALID");
            return { handled: true };
        }

        const updatedSchedules = [...schedules, parsed];
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_ADD_ANOTHER", { schedules: updatedSchedules });
        await reply(buildWhatsappScheduleAddedSummaryText(parsed), "RECURRING_SCHEDULES_SCHEDULE_ADDED");
        return { handled: true };
    }

    // pending.status === "AWAITING_ADD_ANOTHER"
    if (wantsBack) {
        // Corregir el ÚLTIMO horario confirmado: se descarta y se vuelve a
        // pedir el mensaje compacto completo (ya no hay sub-pasos parciales
        // que restaurar).
        const remainingSchedules = schedules.slice(0, -1);
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_TIME_RANGE", { schedules: remainingSchedules });
        await reply(buildWhatsappRecurringStartTimePromptText(remainingSchedules.length === 0), "RECURRING_SCHEDULES_EDIT_LAST_SCHEDULE");
        return { handled: true };
    }

    // Reutiliza classifyInitialIntent, igual que Fase 3E.
    const intent = classifyInitialIntent(text);
    if (intent === "AFFIRMATIVE") {
        await updatePendingStepInputStatusDep(conversationId, "AWAITING_TIME_RANGE", { schedules });
        await reply(WHATSAPP_RECURRING_SCHEDULE_NEXT_PROMPT_TEXT, "RECURRING_SCHEDULES_ADD_ANOTHER");
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

// Fase 3K, sección 11 — step TICKET_NAME: colapsa nombre + precio en UN
// mensaje ("General, 8000") en vez de 2 preguntas (TICKET_NAME, un
// SINGLE_SELECT numerado de 7 opciones + "Otro", y TICKET_PRICE). Sin
// WhatsappPendingStepInput: cada entrada arranca fresca en TICKET_NAME
// (ADD_ANOTHER_TICKET vuelve directo acá, steps/definitions.js), nunca hay
// nada que recordar entre mensajes para este step puntual.
//
// La CANTIDAD disponible (TICKET_QUANTITY) NO se combina: es stock real
// que el organizador tiene que decidir, nunca se inventa un valor — sigue
// preguntándose aparte, con el prompt genérico que ya trae el motor. Por
// eso este sub-flujo termina en TICKET_QUANTITY (no en ADD_ANOTHER_TICKET):
// el resto del recorrido sigue el camino normal (fallback genérico +
// extractWhatsappReplyText#stepId==="ADD_ANOTHER_TICKET" para la
// numeración Sí/No).
async function tryHandleTicketComboSubflow({ conversationId, text, reply, handleConversationInput, currentState }) {
    if (currentState?.prompt?.stepId !== "TICKET_NAME") {
        return { handled: false };
    }

    if (isBackCommand(text)) {
        const backResult = await handleConversationInput(conversationId, { action: "BACK" });
        await reply(extractWhatsappReplyText(backResult), "TICKET_COMBO_BACK_TO_PREVIOUS_STEP");
        return { handled: true };
    }

    const parsed = parseWhatsappTicketComboText(text);
    if (!parsed) {
        await reply(buildWhatsappTicketComboInvalidText(), "TICKET_COMBO_INVALID");
        return { handled: true };
    }

    const nameOptionId = resolveWhatsappTicketNameOptionId(parsed.name);
    let result = await handleConversationInput(conversationId, { value: nameOptionId });
    if (result?.prompt?.error) {
        // No debería pasar nunca (nameOptionId siempre es un id real de
        // las opciones de TICKET_NAME, ver resolveWhatsappTicketNameOptionId).
        await reply(buildWhatsappTicketComboInvalidText(), "TICKET_COMBO_NAME_REJECTED");
        return { handled: true };
    }

    if (nameOptionId === "OTHER") {
        // El motor pasó a TICKET_NAME_CUSTOM (steps/definitions.js) —
        // se le manda el nombre libre tal cual, en la misma respuesta del
        // organizador, sin pedirlo de nuevo.
        result = await handleConversationInput(conversationId, { value: parsed.name });
        if (result?.prompt?.error) {
            await reply(buildWhatsappTicketComboInvalidText(), "TICKET_COMBO_CUSTOM_NAME_REJECTED");
            return { handled: true };
        }
    }

    result = await handleConversationInput(conversationId, { value: parsed.price });
    if (result?.prompt?.error) {
        // No debería pasar nunca (parseWhatsappTicketPriceText ya exige un
        // entero >= 0, la misma regla real de inputHandlers/price.js).
        await reply(buildWhatsappTicketComboInvalidText(), "TICKET_COMBO_PRICE_REJECTED");
        return { handled: true };
    }

    await reply(extractWhatsappReplyText(result), "TICKET_COMBO_ADDED");
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
// Fase 3H — `currentState` resuelto UNA sola vez por el caller (ver
// comentario equivalente en tryHandleFunctionCardSubflow).
async function tryHandleYesNoSubflow({ conversationId, text, reply, handleConversationInput, currentState }) {
    if (currentState?.prompt?.inputType !== "YES_NO") {
        return { handled: false };
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
    const isVideoSocialGate = currentState.prompt.stepId === "PROMO_VIDEO_ASK";
    let result = await handleConversationInput(conversationId, { value: mapped === null ? text : mapped });

    // Fase 3K, sección 15 — PROMO_VIDEO_ASK se reescribe como una única
    // "puerta" (video O redes, ver QUESTION_TEXT_OVERRIDES/extractWhatsappReplyText)
    // para no obligar a dos preguntas separadas cuando la respuesta es
    // "no quiero ninguna de las dos". Si la respuesta fue negativa
    // (mapped===false) y el motor avanzó a SOCIAL_LINKS_ASK (steps/definitions.js:
    // PROMO_VIDEO_ASK.next cuando wantsPromoVideo=false), se responde ESA
    // pregunta también con `false` en la misma vuelta — nunca se le
    // vuelve a preguntar algo que ya dijo que no quería. Si la respuesta
    // fue afirmativa, no se toca nada: sigue el camino normal (URL de
    // YouTube y, después, SOCIAL_LINKS_ASK preguntada de verdad).
    if (isVideoSocialGate && mapped === false && result?.prompt?.stepId === "SOCIAL_LINKS_ASK") {
        result = await handleConversationInput(conversationId, { value: false });
    }

    await reply(extractWhatsappReplyText(result), "YES_NO_ANSWERED");
    return { handled: true };
}

// Fase 3G, sección 7 — step PREVIEW: reemplaza el error "Elegí PUBLISH,
// DRAFT o EDIT" (nunca debe llegar texto crudo al motor acá) por un menú
// numerado 1/2/3, mapeado a las acciones REALES que ya entiende
// EventCreationEngine.handlePreviewInput/handleBack — nunca se inventa
// semántica nueva. Sin WhatsappPendingStepInput: es una decisión de una
// sola respuesta, igual que YES_NO/WEEKDAYS.
// Fase 3H — `currentState` resuelto UNA sola vez por el caller (ver
// comentario equivalente en tryHandleFunctionCardSubflow).
async function tryHandlePreviewSubflow({ conversationId, text, reply, handleConversationInput, currentState }) {
    if (currentState?.prompt?.stepId !== "PREVIEW") {
        return { handled: false };
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
        clearPendingSelection = clearPendingOrganizationSelection,
        resolveOwner = resolveOrganizationOwner,
        uploadImage = uploadWhatsappImageMessage,
        getPendingStepInput: getPendingStepInputDep = getPendingStepInput,
        resetPendingStepInput: resetPendingStepInputDep = resetPendingStepInput,
        updatePendingStepInputStatus: updatePendingStepInputStatusDep = updatePendingStepInputStatus,
        deletePendingStepInput: deletePendingStepInputDep = deletePendingStepInput,
        claimInboundMessage: claimInboundMessageDep = noopClaimInboundMessage,
        completeInboundMessageClaim: completeInboundMessageClaimDep = noopCompleteInboundMessageClaim,
        failInboundMessageClaim: failInboundMessageClaimDep = noopFailInboundMessageClaim,
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
    // Bug fix (imagen esperada en WhatsApp): cualquier OTRO tipo de mensaje
    // (video/audio/documento/sticker/contacts/etc. — nunca text/image/
    // location, que ya tienen su propio camino) también queda descartado
    // por shouldAutoReply. Antes de este fix se ignoraba en silencio incluso
    // cuando el organizador estaba parado justo en COVER_IMAGE (IMAGE_URL);
    // se deja pasar acá para poder revisar el step real más abajo y, sólo
    // en ese caso puntual, pedir explícitamente una foto.
    const isOtherMediaType =
        typeof message?.type === "string" && message.type !== "text" && message.type !== "image" && message.type !== "location";
    if (!shouldAutoReply(message) && !isProcessableImage && !isProcessableLocation && !isOtherMediaType) return;

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

    // Fase 3H — timer diagnóstico (WHATSAPP_PERF_LOG=true, ver
    // utils/whatsappPerf.js), no-op por defecto. `activeConversationId` es
    // una variable capturada por el closure de `reply` en vez de un
    // parámetro extra: así no hace falta tocar ninguno de los ~30 call
    // sites de `reply(...)` que ya existen — se completa sola apenas se
    // resuelve `active` más abajo.
    const perf = startWhatsappPerfTimer();
    // Fase 3N — desde este punto, CUALQUIER query Prisma real que dispare
    // este mismo mensaje (motor, discovery, event.service.js, etc., sin
    // importar cuántas capas de por medio) queda asociada a este `perf`
    // exacto vía AsyncLocalStorage — ver instrumentPrismaClient,
    // utils/whatsappPerf.js. No-op si WHATSAPP_PERF_LOG no está activo.
    enterWithActiveTimer(perf);
    // Fase 4 (optimización de latencia) — mismo mecanismo y mismo punto de
    // entrada que enterWithActiveTimer: un contexto de AsyncLocalStorage
    // nuevo por mensaje (ver conversationStateRequestCache.js), nunca una
    // Map global. Web (conversation.controller.js) nunca llama a esto, así
    // que su comportamiento queda exactamente igual que antes.
    enterWithConversationStateRequestCache();

    // Fase CIERRE — idempotencia: el wamid (message.messageId) es el ÚNICO
    // identificador estable de reentrega que manda Meta — se reclama ACÁ,
    // antes de tocar Prisma/Meta por cualquier otro motivo (findActiveConversation
    // es el primer efecto secundario real de la rama de abajo). Ver
    // services/whatsappInboundMessageClaim.service.js para el diseño
    // completo del reclamo atómico.
    //
    // `dedupeActive` sólo es true cuando ESTA entrega ganó el reclamo — es
    // la única condición bajo la cual el finally de más abajo debe tocar la
    // tabla de idempotencia (nunca marcar completed/failed sobre un reclamo
    // que no es nuestro). Dos casos la dejan en false a propósito, sin
    // abortar el mensaje:
    //   (a) mensaje sin wamid (anomalía — Meta siempre lo manda en un
    //       mensaje real) — se procesa exactamente como si esta fase no
    //       existiera, con una advertencia segura (nunca PII);
    //   (b) el propio mecanismo de reclamo lanza un error inesperado (ej.
    //       la tabla de idempotencia momentáneamente inalcanzable) — se
    //       degrada a procesar sin deduplicar antes que bloquear un mensaje
    //       real por una falla ajena a él.
    const wamid = message.messageId;
    let dedupeActive = false;
    if (typeof wamid === "string" && wamid.length > 0) {
        try {
            const claim = await claimInboundMessageDep(wamid);
            if (!claim.claimed) {
                // Nunca texto/teléfono/payload — sólo el motivo técnico y el
                // tipo de mensaje, igual que el resto de los logs de este
                // archivo.
                logger.info("[WA_DEDUP] DUPLICATE_IGNORED", { reason: claim.reason, messageType: message?.type });
                return;
            }
            dedupeActive = true;
        } catch (claimError) {
            logger.error(claimError, { context: "whatsapp inbound dedupe: fallo al reclamar, se procesa sin deduplicar" });
        }
    } else {
        logger.warn("WhatsApp inbound message sin wamid: se procesa sin deduplicar", { messageType: message?.type });
    }
    perf.mark("CLAIM_DEDUPE");

    let activeConversationId = null;
    // `context` opcional (default {}) — hoy sólo lo pasan los call sites del
    // saludo (organizationId, ver GREETING más abajo), nunca obliga a tocar
    // los demás.
    const reply = (replyText, engineAction, context) =>
        sendBotReply({ sendText, to, from: message.from, messageId: message.messageId, text: replyText, engineAction, perf, conversationId: activeConversationId, context });

    let processingFailed = false;
    try {
        const active = await findActiveConversation({ channel: WHATSAPP_CHANNEL, channelRef });
        activeConversationId = active?.id ?? null;
        perf.mark("FIND_CONVERSATION");

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
            perf.mark("RESUME");
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

            // Fase 3H — un único resume acá: es el único sub-flujo invocado
            // en esta rama (mensaje type==="location"), así que no había
            // redundancia previa que eliminar, pero se mide igual para tener
            // el mismo punto de referencia que la rama de texto.
            const currentState = await resumeConversation(active.id);
            perf.mark("RESUME");
            const pending = isPendingStepInputStep(currentState) ? await getPendingStepInputDep(active.id) : null;
            perf.mark("PENDING_READ");

            const locationResult = await tryHandleLocationSubflow({
                conversationId: active.id,
                message,
                text,
                reply,
                handleConversationInput,
                currentState,
                pending,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            perf.mark("SUBFLOW");
            if (locationResult.handled) return;

            // Bug fix (imagen esperada en WhatsApp): si el step real es
            // justo COVER_IMAGE (IMAGE_URL), "no necesito una ubicación acá"
            // es engañoso — lo que hace falta es específicamente una foto.
            if (currentState?.prompt?.inputType === "IMAGE_URL") {
                await reply(WHATSAPP_IMAGE_REQUIRED_TEXT, "IMAGE_REQUIRED_INVALID_CONTENT");
                return;
            }

            await reply(`${WHATSAPP_LOCATION_NOT_EXPECTED_TEXT}\n\n${extractWhatsappReplyText(currentState)}`, "LOCATION_NOT_EXPECTED");
            return;
        }

        // Bug fix (imagen esperada en WhatsApp): cualquier tipo de mensaje
        // que no sea text/image/location (video/audio/documento/sticker/
        // etc.) sólo importa si hay una conversación activa parada justo en
        // COVER_IMAGE — ahí se pide la foto explícitamente, sin tocar el
        // motor, el draft, el pending step ni Cloudinary. Para cualquier
        // otro step se preserva el comportamiento previo a este fix: se
        // ignora en silencio (mismo criterio que shouldAutoReply ya aplicaba
        // para estos tipos).
        if (isOtherMediaType) {
            if (!active) return;

            const currentState = await resumeConversation(active.id);
            perf.mark("RESUME");
            if (currentState?.prompt?.inputType === "IMAGE_URL") {
                await reply(WHATSAPP_IMAGE_REQUIRED_TEXT, "IMAGE_REQUIRED_INVALID_CONTENT");
            }
            return;
        }

        // Verificación de teléfono de Organización — flujo invertido: el
        // organizador manda "CONFIRMAR <token>" DESDE el número que se está
        // verificando (alta nueva o cambio, deep link wa.me armado por
        // organizationPhoneVerification.service.js). Se revisa ANTES de la
        // conversación del bot: una confirmación de teléfono nunca debe
        // interpretarse como respuesta a un paso del motor. El token
        // desambigua entre organizaciones (@unique global, ver el
        // comentario del modelo) — message.from se exige IGUAL como
        // segundo factor. Si el texto no matchea el patrón, o el token no
        // corresponde a ninguna verificación PENDING vigente para ESE
        // message.from exacto (el wa_id real que mandó Meta, nunca uno
        // inferido/normalizado para test mode), confirmOrganizationPhoneFromWebhook
        // no hace nada y el mensaje sigue su camino normal más abajo.
        if (message.type === "text") {
            const parsedConfirmation = parseOrganizationPhoneConfirmationMessage(text);
            if (parsedConfirmation) {
                const { confirmed } = await confirmOrganizationPhoneFromWebhook({ waId: message.from, token: parsedConfirmation.token });
                if (confirmed) {
                    await sendText({ to, text: "✅ ¡Listo! Verificamos tu WhatsApp como número de contacto." }).catch((error) => {
                        logger.warn("receiveWhatsappWebhook: no se pudo enviar la confirmación de teléfono verificado", { reason: error.message });
                    });
                    return;
                }
            }
        }

        if (active) {
            if (isCancelCommand(text)) {
                await cancelConversation(active.id, active.userId);
                await reply(WHATSAPP_CANCEL_TEXT, "CANCEL");
                return;
            }

            // Fase 3H — AUDITORÍA DE PERFORMANCE (ver informe de entrega,
            // sección "N consultas por mensaje"): antes de esta fase, CADA
            // uno de los 8 sub-flujos de abajo (LOCATION/FUNCTION_CARD/
            // FUNCTIONS_LIST/RANGE/WEEKDAYS/SCHEDULES/YES_NO/PREVIEW) volvía
            // a llamar resumeConversation por su cuenta, y 5 de ellos
            // también volvían a llamar getPendingStepInput — aunque sólo UNO
            // de los 8 termina manejando cada mensaje. Para un mensaje en un
            // step "plano" (NAME, DESCRIPTION, CATEGORY, TICKET_*, etc., que
            // ningún sub-flujo reclama), eso eran hasta 8 lecturas idénticas
            // de ConversationState + hasta 5 lecturas idénticas de
            // WhatsappPendingStepInput para UN SOLO mensaje — la mayor
            // redundancia encontrada en la auditoría.
            //
            // Ninguno de los 8 sub-flujos escribe NADA antes de confirmar
            // que el step real vigente es el suyo (todos empiezan con "si no
            // es mi step, handled:false" antes de tocar handleConversationInput/
            // Prisma) — así que resolver `currentState` UNA sola vez acá y
            // pasarlo a los 8 es exactamente equivalente: nada puede mutar
            // el resultado entre una llamada y la siguiente dentro del mismo
            // mensaje. `pending` sigue el mismo razonamiento, y además sólo
            // se pide si el step real vigente es alguno de los 5 que
            // realmente consumen WhatsappPendingStepInput (isPendingStepInputStep)
            // — para cualquier otro step, ni siquiera esa lectura hace falta,
            // porque los 5 sub-flujos que la usan igual devuelven
            // handled:false sin mirar `pending` cuando el step no es el suyo.
            const currentState = await resumeConversation(active.id);
            perf.mark("RESUME");
            const pending = isPendingStepInputStep(currentState) ? await getPendingStepInputDep(active.id) : null;
            perf.mark("PENDING_READ");

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
                currentState,
                pending,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (locationResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

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
                currentState,
                pending,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (functionCardResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            // Fase 3E — FUNCTIONS_LIST ("varias funciones") se intercepta
            // ACÁ, mismo criterio que FUNCTIONS_SINGLE_CARD/LOCATION: el
            // motor sólo puede recibir el array completo de funciones, y
            // sólo al finalizar el ciclo. Ver tryHandleFunctionsListSubflow.
            const functionsListResult = await tryHandleFunctionsListSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                currentState,
                pending,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (functionsListResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            // Fase 3F — RECURRING: tres steps reales distintos (rango, días,
            // horarios), cada uno interceptado ANTES del motor con el mismo
            // criterio que los sub-flujos anteriores.
            const recurringRangeResult = await tryHandleRecurringRangeSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                currentState,
                pending,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (recurringRangeResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            const recurringWeekdaysResult = await tryHandleRecurringWeekdaysSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                currentState,
            });
            if (recurringWeekdaysResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            const recurringSchedulesResult = await tryHandleRecurringSchedulesSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                currentState,
                pending,
                resetPendingStepInput: resetPendingStepInputDep,
                updatePendingStepInputStatus: updatePendingStepInputStatusDep,
                deletePendingStepInput: deletePendingStepInputDep,
            });
            if (recurringSchedulesResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            // Fase 3K, sección 11 — step TICKET_NAME: nombre+precio en un
            // mensaje, mismo criterio que los sub-flujos anteriores.
            const ticketComboResult = await tryHandleTicketComboSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                currentState,
            });
            if (ticketComboResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            // Fase 3G — steps YES_NO (WANTS_FREE_TICKETS/PROMO_VIDEO_ASK/
            // SOCIAL_LINKS_ASK/ADD_ANOTHER_SOCIAL) y PREVIEW (resumen final +
            // PUBLICAR/BORRADOR/VOLVER), mismo criterio que los sub-flujos
            // anteriores: se interceptan ANTES del motor.
            const yesNoResult = await tryHandleYesNoSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                currentState,
            });
            if (yesNoResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            const previewResult = await tryHandlePreviewSubflow({
                conversationId: active.id,
                text,
                reply,
                handleConversationInput,
                currentState,
            });
            if (previewResult.handled) {
                perf.mark("SUBFLOW");
                return;
            }

            // Fase 3K, sección 18 — "volver" central para CUALQUIER step sin
            // sub-flujo propio (NAME, DESCRIPTION, CATEGORY, CUSTOM_CATEGORY,
            // EVENT_PRICING_TYPE, TICKET_PRICE/QUANTITY, PROMO_VIDEO_URL,
            // SOCIAL_NETWORK/URL, etc.). Los sub-flujos de arriba (LOCATION,
            // funciones, entradas, YES_NO, PREVIEW) ya manejan "volver" cada
            // uno con su propia semántica (a veces retrocede un sub-paso
            // interno antes de tocar el motor) y devuelven {handled:true}
            // ANTES de llegar acá — este chequeo sólo se alcanza para los
            // steps que no tienen ningún sub-paso interno que resolver,
            // así que BACK real del motor (agnóstico al inputType, ver
            // EventCreationEngine.handleInput) es exactamente lo correcto:
            // un único punto central, no un hack por step (sección 18 del
            // pedido: "resolverlo centralmente").
            if (isBackCommand(text)) {
                const backResult = await handleConversationInput(active.id, { action: "BACK" });
                perf.mark("SUBFLOW");
                await reply(extractWhatsappReplyText(backResult), "GLOBAL_BACK");
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
            perf.mark("SUBFLOW");
            // Bug fix (imagen esperada en WhatsApp): un texto que YA es una
            // URL http(s) válida sigue funcionando igual que siempre (el
            // motor la acepta, ver inputHandlers/imageUrl.js#parse) — sólo
            // se reemplaza la respuesta cuando el motor la rechazó
            // (prompt.error) y el step que la rechazó es justo IMAGE_URL: el
            // error genérico de ese handler ("Subí la imagen a
            // /api/media/upload…") está pensado para Web, no tiene sentido
            // para un organizador escribiendo por WhatsApp.
            if (result?.prompt?.error && result.prompt.inputType === "IMAGE_URL") {
                await reply(WHATSAPP_IMAGE_REQUIRED_TEXT, "IMAGE_REQUIRED_INVALID_CONTENT");
                return;
            }
            await reply(extractWhatsappReplyText(result), "HANDLE_INPUT");
            return;
        }

        // Fase 3L — auditoría de performance: esta rama entera (sin
        // conversación activa todavía: saludo, selección pendiente,
        // descubrimiento por teléfono) no tenía NINGUNA marca de perf —
        // todo su costo real (hasta 4 consultas/escrituras a Prisma, ver
        // informe de entrega, sección "queries por mensaje") quedaba
        // invisible, colapsado en un solo BUILD_REPLY sin desglosar. Es
        // EXACTAMENTE el camino de los escenarios señalados como lentos
        // (saludo inicial, "¿querés publicar?" -> "1", elegir organización)
        // — se agregan las mismas marcas nominales que ya usa la rama de
        // conversación activa (FIND_CONVERSATION/RESUME/SUBFLOW), sin
        // cambiar ningún comportamiento: perf.mark es no-op cuando
        // WHATSAPP_PERF_LOG no está activo (ver utils/whatsappPerf.js).
        const pendingSelection = await getPendingSelection(channelRef);
        perf.mark("PENDING_SELECTION_READ");

        if (pendingSelection) {
            if (isCancelCommand(text)) {
                await clearPendingSelection(channelRef);
                perf.mark("CLEAR_SELECTION");
                await reply(WHATSAPP_CANCEL_TEXT, "CANCEL");
                return;
            }

            // pendingSelection.status === "AWAITING_SELECTION" — único status
            // posible acá: nada deja un pendingSelection en otro estado.
            const choice = resolveOrganizationSelectionChoice(pendingSelection.candidateOrganizationIds, text);
            if (!choice.valid) {
                await reply(WHATSAPP_SELECTION_INVALID_TEXT, "SELECTION_INVALID");
                return;
            }

            const owner = await resolveOwner(choice.organizationId);
            perf.mark("RESOLVE_OWNER");
            if (!owner) {
                // La Organization elegida dejó de estar APPROVED entre el
                // descubrimiento y la elección — nunca se sigue con una
                // Organization inválida.
                await clearPendingSelection(channelRef);
                await reply(WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT, "SELECTION_ORG_UNAVAILABLE");
                return;
            }

            // Bug fix (confirmación redundante): elegir una organización del
            // selector YA ES la confirmación explícita del organizador — no
            // hace falta volver a preguntar "¿Vamos a publicar con X? Sí/No"
            // (eso obligaba a un mensaje extra por nada). Se persiste la
            // elección liberando el pending selection y se arranca
            // EventCreationEngine directo, exactamente como ya hacía este
            // mismo bloque para AWAITING_CONFIRMATION + "Sí" — la única
            // diferencia es que ahora se llega acá un mensaje antes.
            await clearPendingSelection(channelRef);
            perf.mark("CLEAR_SELECTION");
            const startResult = await startConversation({
                clerkId: owner.clerkId,
                channel: WHATSAPP_CHANNEL,
                channelRef,
                organizationId: choice.organizationId,
            });
            perf.mark("START");
            await reply(extractWhatsappReplyText(startResult), "START");
            return;
        }

        const intent = classifyInitialIntent(text);
        const candidates = await discoverCandidates(channelRef);
        perf.mark("DISCOVER");

        if (candidates.length === 0) {
            await reply(WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT, "ORGANIZATION_NOT_FOUND");
            return;
        }

        // Fase 3K — el nombre de la PERSONA (nunca el de la organización en
        // su lugar) sale de User.firstName, y sólo se usa si es inequívoco
        // entre todas las candidatas (ver resolvePersonFirstName). Se
        // resuelve una sola vez acá porque tanto Caso A como el saludo
        // genérico de Caso B lo necesitan.
        const personFirstName = resolvePersonFirstName(candidates);

        if (candidates.length === 1) {
            const [organization] = candidates;

            if (intent === "AFFIRMATIVE") {
                const startResult = await startConversation({
                    clerkId: organization.clerkId,
                    channel: WHATSAPP_CHANNEL,
                    channelRef,
                    organizationId: organization.organizationId,
                });
                perf.mark("START");
                await reply(extractWhatsappReplyText(startResult), "START");
                return;
            }

            if (intent === "NEGATIVE") {
                await reply(WHATSAPP_DECLINE_TEXT, "DECLINE");
                return;
            }

            await reply(buildKnownOrganizationGreetingText(personFirstName, organization.name), "GREETING", { organizationId: organization.organizationId });
            return;
        }

        // candidates.length > 1 — Caso B. Sin estado persistido para este
        // primer paso (igual de "sin memoria" que el saludo de Caso A): si
        // la intención ya es afirmativa (dijo "Sí"/"dale", con o sin haber
        // visto el saludo genérico antes) se muestra el selector
        // directamente — menos fricción para quien ya sabe qué quiere.
        if (intent === "NEGATIVE") {
            await reply(WHATSAPP_DECLINE_TEXT, "DECLINE");
            return;
        }

        if (intent !== "AFFIRMATIVE") {
            // Caso B: varias Organizations candidatas, ninguna elegida
            // todavía — no hay un organizationId único que loguear, así que
            // se deja constancia de las candidatas (nunca más de lo que ya
            // resolvió discoverCandidates, nada nuevo que consultar).
            await reply(buildGenericPublishIntentGreetingText(personFirstName), "GREETING", {
                candidateOrganizationIds: candidates.map((candidate) => candidate.organizationId),
            });
            return;
        }

        await createPendingSelection(
            channelRef,
            candidates.map((candidate) => candidate.organizationId)
        );
        perf.mark("CREATE_SELECTION");
        await reply(buildOrganizationSelectorText(candidates), "SELECTOR");
    } catch (error) {
        processingFailed = true;
        logger.error(error, { context: "whatsapp organizer bot", inboundMessageId: message.messageId });
    } finally {
        // Fase CIERRE — el reclamo sólo se finaliza si ESTA entrega lo ganó
        // (dedupeActive); nunca se toca la tabla de idempotencia por un
        // mensaje sin wamid o cuyo reclamo falló al adquirirse (ver arriba).
        // `finally` corre en TODOS los caminos de salida del try (los ~15
        // `return;` internos incluidos, ver los sub-flujos de más arriba) —
        // es lo que permite finalizar el reclamo sin tocar ninguno de esos
        // returns existentes.
        if (dedupeActive) {
            try {
                if (processingFailed) {
                    await failInboundMessageClaimDep(wamid);
                } else {
                    await completeInboundMessageClaimDep(wamid);
                }
            } catch (finalizeError) {
                // Nunca deja escapar: si ni siquiera se puede liberar/cerrar
                // el reclamo, el peor caso es que quede PROCESSING hasta que
                // venza el lease (ver CLAIM_LEASE_MS) — reintentable más
                // tarde, nunca un mensaje perdido para siempre.
                logger.error(finalizeError, { context: "whatsapp inbound dedupe: no se pudo finalizar el reclamo" });
            }
        }
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
// Verificación de teléfono de Organizaciones — auditoría: este endpoint no
// tenía ninguna validación criptográfica de origen (ver el informe de
// entrega, sección "Validación webhook Meta"). `req.rawBody` lo captura el
// `verify` de express.json() en app.js — SIEMPRE los bytes crudos, nunca
// req.body re-serializado. Si WHATSAPP_APP_SECRET no está configurada
// (getWhatsappAppSecret lanza), se falla CERRADO (se rechaza el request)
// en vez de procesar sin firma — nunca "no hay secreto, dejo pasar todo".
function isWhatsappWebhookSignatureValid(req) {
    let secret;
    try {
        secret = getWhatsappAppSecret();
    } catch (error) {
        logger.error(error, { context: "receiveWhatsappWebhook: WHATSAPP_APP_SECRET no configurada, rechazando por seguridad (fail-closed)" });
        return false;
    }
    return verifyWhatsappWebhookSignature({ signatureHeader: req.get("X-Hub-Signature-256"), rawBody: req.rawBody, secret });
}

export const receiveWhatsappWebhook = (req, res) => {
    if (!isWhatsappWebhookSignatureValid(req)) {
        logger.warn("receiveWhatsappWebhook: firma inválida o ausente, request rechazado");
        res.sendStatus(401);
        return;
    }

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
    //
    // Fase CIERRE — único lugar de todo el proyecto que cablea
    // explícitamente el servicio REAL de idempotencia (ver el comentario
    // junto a noopClaimInboundMessage más arriba, sección "por qué no es el
    // default"). El resto de las ~15 dependencias de processInboundMessage
    // sigue sin pasarse acá — cada una resuelve a su propio default real,
    // exactamente como antes de esta fase.
    void processInboundMessages(messages, { claimInboundMessage, completeInboundMessageClaim, failInboundMessageClaim });

    res.sendStatus(200);
};
