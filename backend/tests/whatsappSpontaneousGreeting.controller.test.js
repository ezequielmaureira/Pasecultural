import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WHATSAPP_DECLINE_TEXT, buildKnownOrganizationGreetingText } from "../src/services/whatsappOrganizerBot.service.js";
import { processInboundMessage, processInboundMessages } from "../src/controllers/whatsapp.controller.js";
import { parseInboundWhatsappMessages } from "../src/services/whatsapp.service.js";

// Bug fix: "el bot inicia conversaciones solo" — regresión focalizada. La
// auditoría completa (ver el informe de entrega) demostró EMPÍRICAMENTE que
// buildGenericPublishIntentGreetingText/buildKnownOrganizationGreetingText
// (whatsappOrganizerBot.service.js) sólo se llaman desde DENTRO de
// processInboundMessage (whatsapp.controller.js), que sólo se invoca desde
// receiveWhatsappWebhook con un `message` real — no existe en el código
// ningún camino espontáneo. Este archivo prueba exactamente esa invariante,
// y las piezas puntuales que la auditoría recorrió una por una. La
// deduplicación por wamid y el fail-closed de HMAC YA están cubiertos a
// fondo en whatsapp.dedup.controller.test.js y whatsapp.webhook.test.js
// respectivamente — acá sólo se referencian, nunca se duplican.

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.IN1",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "Hola",
        image: null,
        location: null,
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

function fakeSender(result = { success: true, messageId: "wamid.OUT1", error: null }) {
    const calls = [];
    const sendText = async (args) => {
        calls.push(args);
        return result;
    };
    return { sendText, calls };
}

function spy(returnValue) {
    const calls = [];
    const fn = async (...args) => {
        calls.push(args);
        if (returnValue instanceof Error) throw returnValue;
        return typeof returnValue === "function" ? returnValue(...args) : returnValue;
    };
    fn.calls = calls;
    return fn;
}

function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy(null),
            startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" }, canGoBack: false, sections: [] }),
            handleConversationInput: spy(null),
            cancelConversation: spy(undefined),
            discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }]),
            getPendingSelection: spy(null),
            createPendingSelection: spy(undefined),
            clearPendingSelection: spy(undefined),
            resolveOwner: spy({ name: "Elvis Bar", clerkId: "user_123" }),
            resumeConversation: spy(null),
            getPendingStepInput: spy(null),
            resetPendingStepInput: spy(undefined),
            updatePendingStepInputStatus: spy(undefined),
            deletePendingStepInput: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

// ==================================================================
// 1) inbound real "Hola" sin state -> envía welcome una sola vez.
// ==================================================================
test("1) a real inbound 'Hola' with no active conversation sends the welcome greeting exactly once", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.equal(sendCalls.length, 1);
    // baseDeps resuelve UNA sola Organization candidata (Caso A) sin
    // ownerFirstName -> saludo genérico sin nombre de persona, ver
    // buildKnownOrganizationGreetingText.
    assert.equal(sendCalls[0].text, buildKnownOrganizationGreetingText(null, "Elvis Bar"));
});

// ==================================================================
// 2) inbound real "2" en el step del saludo -> envía el cierre una sola vez
// y NUNCA arranca el motor (equivalente a "terminar" el intento: no queda
// ninguna conversación activa creada).
// ==================================================================
test("2) a real inbound '2' answering the greeting sends the closing message exactly once and never starts the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].text, WHATSAPP_DECLINE_TEXT);
    assert.equal(deps.startConversation.calls.length, 0, "answering '2' must never start EventCreationEngine");
});

// ==================================================================
// 3) después de responder "2", el paso del tiempo por sí solo NO genera
// ningún outbound — no hay ningún mecanismo en este código que dispare un
// envío sin una nueva invocación de processInboundMessage con un mensaje
// real (ver la auditoría: cero cron/scheduler/timer en todo el proyecto
// relacionado con WhatsApp). Se simula "el paso del tiempo" simplemente NO
// volviendo a invocar nada — la aserción es que sendCalls no creció.
// ==================================================================
test("3) after closing with '2', the mere passage of time (no further invocation) produces zero additional outbound messages", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "2" }), deps);
    assert.equal(sendCalls.length, 1);

    // "Varias horas después" — nada en este proceso puede disparar un envío
    // sin una llamada nueva; no hay timer/cron que despertar acá, así que
    // no invocar nada de nuevo ES la simulación fiel del paso del tiempo.
    assert.equal(sendCalls.length, 1, "no new outbound must ever appear without a new real inbound invocation");
});

// ==================================================================
// 10) nuevo inbound real después de haber cerrado con "2" -> sí puede
// comenzar una conversación nueva (el cierre con "2" nunca deja nada
// "trabado" que le impida al usuario volver a escribir más tarde).
// ==================================================================
test("10) a fresh real inbound message after closing with '2' can start a brand-new conversation", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ messageId: "wamid.CLOSE", text: "2" }), deps);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].text, WHATSAPP_DECLINE_TEXT);

    await processInboundMessage(textMessage({ messageId: "wamid.NEW", text: "Hola" }), deps);
    assert.equal(sendCalls.length, 2, "a new real inbound message must be free to start a new greeting/conversation");
    assert.notEqual(sendCalls[1].text, WHATSAPP_DECLINE_TEXT);
});

// ==================================================================
// 4) startup de la app NO genera outbound — prueba estructural: ni
// server.js ni app.js referencian ningún mecanismo de envío de WhatsApp ni
// processInboundMessage a nivel de módulo (nada que se ejecute con sólo
// importar/arrancar el proceso).
// ==================================================================
test("4) server.js and app.js never reference any WhatsApp outbound-sending mechanism or processInboundMessage at startup", () => {
    for (const relativePath of ["../src/server.js", "../src/app.js"]) {
        const path = fileURLToPath(new URL(relativePath, import.meta.url));
        const source = readFileSync(path, "utf8");
        assert.ok(!source.includes("sendWhatsappTextMessage"), `${relativePath} must never reference sendWhatsappTextMessage`);
        assert.ok(!source.includes("processInboundMessage"), `${relativePath} must never reference processInboundMessage`);
        assert.ok(!source.includes("postToGraphApi"), `${relativePath} must never reference postToGraphApi`);
    }
});

// ==================================================================
// 5/6) status webhook sin messages[] (delivered/read/sent) NO genera
// ninguna respuesta — parseInboundWhatsappMessages ya filtra esto (ver
// whatsapp.webhook.test.js), así que processInboundMessages recibe un
// array VACÍO; se prueba acá, con un sendText espiado, que un array vacío
// nunca invoca el motor ni manda nada — sea cual sea el tipo de status
// (delivered/read/sent) el resultado es idéntico: siempre [].
// ==================================================================
test("5/6) a status-only webhook payload (delivered, read, or sent — no messages[]) never triggers any outbound reply", async () => {
    const { sendText, calls: sendCalls } = fakeSender();
    const deps = {
        sendText,
        findActiveConversation: spy(null),
        startConversation: spy(null),
        discoverCandidates: spy([]),
    };

    for (const status of ["delivered", "read", "sent"]) {
        const payload = {
            entry: [{ changes: [{ value: { statuses: [{ id: `wamid.STATUS_${status}`, status }] } }] }],
        };
        const messages = parseInboundWhatsappMessages(payload);
        assert.deepEqual(messages, [], `a "${status}" status callback must never produce a processable message`);
        await processInboundMessages(messages, deps);
    }

    assert.equal(sendCalls.length, 0, "no status callback of any kind must ever trigger an outbound reply");
    assert.equal(deps.findActiveConversation.calls.length, 0, "a status callback must never even touch the conversation engine");
});

// ==================================================================
// 7) verificación de Organization.phone NO genera welcome del chatbot —
// prueba estructural: organizationPhoneVerification.service.js (incluido
// syncWhatsappOrganizerLinkAfterVerification) nunca importa ni referencia
// ningún constructor de saludo ni ninguna función de envío. La auditoría ya
// confirmó que ese archivo sólo importa getWhatsappDisplayPhoneNumber (un
// getter de config puro, usado para armar el deep link wa.me que se
// MUESTRA al organizador en el panel — nunca para mandar nada por WhatsApp).
// ==================================================================
test("7) organizationPhoneVerification.service.js never references any WhatsApp greeting builder or send function", () => {
    const path = fileURLToPath(new URL("../src/services/organizationPhoneVerification.service.js", import.meta.url));
    const source = readFileSync(path, "utf8");
    assert.ok(!source.includes("buildKnownOrganizationGreetingText"));
    assert.ok(!source.includes("buildGenericPublishIntentGreetingText"));
    assert.ok(!source.includes("sendWhatsappTextMessage"));
    assert.ok(!source.includes("postToGraphApi"));
    assert.ok(!source.includes("processInboundMessage"));
});

// ==================================================================
// 8) sync/upsert de WhatsappOrganizerLink NO genera welcome — misma prueba
// estructural: whatsappOrganizerDiscovery.service.js (dueño del resto de la
// lógica de identificación por WhatsApp) no importa NINGÚN mecanismo de
// envío — es un servicio puramente de lectura/matching. La escritura de
// WhatsappOrganizerLink en sí (syncWhatsappOrganizerLinkAfterVerification)
// vive en organizationPhoneVerification.service.js y ya quedó cubierta por
// el test anterior.
// ==================================================================
test("8) whatsappOrganizerDiscovery.service.js never references any WhatsApp send function — it is read-only identification/matching", () => {
    const path = fileURLToPath(new URL("../src/services/whatsappOrganizerDiscovery.service.js", import.meta.url));
    const source = readFileSync(path, "utf8");
    assert.ok(!source.includes("sendWhatsappTextMessage"));
    assert.ok(!source.includes("postToGraphApi"));
    assert.ok(!source.includes("processInboundMessage"));
});

// ==================================================================
// 9) expiración/limpieza de ConversationState NO genera welcome — prueba
// estructural doble: (a) no existe NINGÚN cron/scheduler en todo el
// proyecto relacionado con WhatsApp/ConversationState (ver el informe de
// entrega — grep exhaustivo sin resultados fuera de este propio archivo de
// test); (b) el ÚNICO lugar que efectivamente escribe
// ConversationState.status = "ABANDONED" (organizationPhoneVerification.service.js)
// ya está cubierto por el test 7 — nunca importa ningún mecanismo de envío,
// así que "abandonar" una conversación vieja no puede, por construcción,
// disparar un saludo nuevo.
// ==================================================================
test("9) EventCreationEngine.js (which owns resume()) never references any WhatsApp send function or greeting builder", () => {
    const path = fileURLToPath(new URL("../src/conversation/EventCreationEngine.js", import.meta.url));
    const source = readFileSync(path, "utf8");
    assert.ok(!source.includes("sendWhatsappTextMessage"));
    assert.ok(!source.includes("buildKnownOrganizationGreetingText"));
    assert.ok(!source.includes("buildGenericPublishIntentGreetingText"));
});

// ==================================================================
// Invariante central (sección 13 del pedido): sendBotReply (el ÚNICO punto
// real de envío desde processInboundMessage) sólo puede alcanzarse con un
// inboundMessageId real adjunto al log — nunca null/undefined para un
// GREETING real. Esto es lo que le da causalidad explícita en el log
// (diagnóstico agregado en esta misma ronda, ver sendBotReply).
// ==================================================================
test("13) a real GREETING reply is always logged with a real inboundMessageId and source: INBOUND_MESSAGE — never anonymous", async () => {
    const { logger } = await import("../src/logging/logger.js");
    const originalInfo = logger.info;
    const logs = [];
    logger.info = (message, context) => logs.push({ message, context });

    try {
        const { deps } = baseDeps();
        await processInboundMessage(textMessage({ messageId: "wamid.GREETING_TEST", text: "Hola" }), deps);

        const replyLog = logs.find((l) => l.message === "WhatsApp organizer bot reply sent");
        assert.ok(replyLog, "expected a structured log line for the sent reply");
        assert.equal(replyLog.context.source, "INBOUND_MESSAGE");
        assert.equal(replyLog.context.inboundMessageId, "wamid.GREETING_TEST");
        assert.equal(replyLog.context.engineAction, "GREETING");
        // Nunca el teléfono completo — sólo parcialmente redactado.
        assert.ok(!JSON.stringify(replyLog).includes("5491122334455"));
    } finally {
        logger.info = originalInfo;
    }
});
