import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoReply, AUTO_REPLY_TEXT } from "../src/services/whatsapp.service.js";
import {
    classifyInitialIntent,
    isCancelCommand,
    extractWhatsappReplyText,
    buildWhatsappLinkChallengeText,
    WHATSAPP_DECLINE_TEXT,
    WHATSAPP_CANCEL_TEXT,
    WHATSAPP_LINK_CHALLENGE_PENDING_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";
import { processInboundMessage, processInboundMessages } from "../src/controllers/whatsapp.controller.js";

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.IN1",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "Hola",
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

function fakeSender(result = { success: true, messageId: "wamid.OUT1", error: null }) {
    const calls = [];
    const sendText = async (args) => {
        calls.push(args);
        if (result instanceof Error) throw result;
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

// deps base: sin conversación activa, identidad SIEMPRE resuelta (mock) —
// cada test override lo que necesite. resolveOrganizerIdentity/
// createLinkChallenge son mocks deliberados (nunca los reales, que tocan
// Prisma) para poder probar el cableo sin base de datos.
function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy(null),
            startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" }, canGoBack: false, sections: [] }),
            handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "DESCRIPTION", type: "QUESTION", text: "¿De qué trata tu evento?" }, canGoBack: true, sections: [] }),
            cancelConversation: spy(undefined),
            resolveOrganizerIdentity: spy({ clerkId: "user_123" }),
            createLinkChallenge: spy({ code: "482731" }),
            ...overrides,
        },
        sendCalls,
    };
}

// ==================================================
// shouldAutoReply — pura, sin cambios de comportamiento en esta fase
// ==================================================

test("shouldAutoReply is true for a valid non-empty text message", () => {
    assert.equal(shouldAutoReply(textMessage()), true);
});

test("shouldAutoReply is false when text is null", () => {
    assert.equal(shouldAutoReply(textMessage({ text: null })), false);
});

test("shouldAutoReply is false when text is empty or whitespace-only", () => {
    assert.equal(shouldAutoReply(textMessage({ text: "" })), false);
    assert.equal(shouldAutoReply(textMessage({ text: "   " })), false);
});

test("shouldAutoReply is false for a non-text message type", () => {
    assert.equal(shouldAutoReply(textMessage({ type: "image", text: null })), false);
});

test("shouldAutoReply is false when from is missing", () => {
    assert.equal(shouldAutoReply(textMessage({ from: null })), false);
});

// ==================================================
// classifyInitialIntent — pura, sin IA (sección 4)
// ==================================================

test("classifyInitialIntent recognizes the documented affirmative phrases", () => {
    for (const text of ["sí", "Si", "S", "dale", "OK", "quiero", "quiero publicar", "Publicar", "crear", "crear evento"]) {
        assert.equal(classifyInitialIntent(text), "AFFIRMATIVE", `esperaba AFFIRMATIVE para "${text}"`);
    }
});

test("classifyInitialIntent recognizes the documented negative phrases", () => {
    for (const text of ["no", "No gracias", "ahora no", "Después", "DESPUES"]) {
        assert.equal(classifyInitialIntent(text), "NEGATIVE", `esperaba NEGATIVE para "${text}"`);
    }
});

test("classifyInitialIntent normalizes case, accents, spaces and simple punctuation", () => {
    assert.equal(classifyInitialIntent("  Sí!  "), "AFFIRMATIVE");
    assert.equal(classifyInitialIntent("¿Sí?"), "AFFIRMATIVE");
});

test("classifyInitialIntent returns UNKNOWN for anything else, including empty/non-string input", () => {
    assert.equal(classifyInitialIntent("Hola"), "UNKNOWN");
    assert.equal(classifyInitialIntent("asdkjh"), "UNKNOWN");
    assert.equal(classifyInitialIntent(""), "UNKNOWN");
    assert.equal(classifyInitialIntent(null), "UNKNOWN");
});

// ==================================================
// isCancelCommand — pura (sección 8)
// ==================================================

test("isCancelCommand recognizes cancelar/cancel/salir regardless of case or simple punctuation", () => {
    assert.equal(isCancelCommand("cancelar"), true);
    assert.equal(isCancelCommand("Cancel"), true);
    assert.equal(isCancelCommand("SALIR!"), true);
});

test("isCancelCommand is false for anything else", () => {
    assert.equal(isCancelCommand("Hola"), false);
    assert.equal(isCancelCommand(""), false);
});

// ==================================================
// extractWhatsappReplyText — adapter motor -> texto WhatsApp (sección 7)
// ==================================================

test("extractWhatsappReplyText returns the question text as-is for a normal QUESTION prompt", () => {
    const result = { prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" } };
    assert.equal(extractWhatsappReplyText(result), "¿Cómo se llama tu evento?");
});

test("extractWhatsappReplyText prefixes the validation error before the re-asked question", () => {
    const result = { prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?", error: "Contame un poco más, no puede quedar vacío." } };
    const text = extractWhatsappReplyText(result);
    assert.ok(text.includes("Contame un poco más"));
    assert.ok(text.includes("¿Cómo se llama tu evento?"));
    assert.ok(text.indexOf("Contame un poco más") < text.indexOf("¿Cómo se llama tu evento?"));
});

test("extractWhatsappReplyText never leaks the raw draft for a PREVIEW prompt", () => {
    const result = { prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "Fiesta", secretInternalField: "no debería salir" } } };
    const text = extractWhatsappReplyText(result);
    assert.equal(typeof text, "string");
    assert.ok(!text.includes("secretInternalField"));
});

test("extractWhatsappReplyText builds a finalization message when the engine reports done", () => {
    assert.match(extractWhatsappReplyText({ done: true, status: "PUBLISHED" }), /public/i);
    assert.match(extractWhatsappReplyText({ done: true, status: "DRAFT_SAVED" }), /borrador/i);
});

test("extractWhatsappReplyText returns null when there is nothing to send", () => {
    assert.equal(extractWhatsappReplyText(null), null);
    assert.equal(extractWhatsappReplyText({ conversationId: "conv1" }), null);
});

// ==================================================
// processInboundMessage — flujo A-L (sección 3/14 del pedido)
// ==================================================

// A) sin conversación + "Hola" -> pregunta si quiere publicar, NO inicia el motor.
test("A) no active conversation + 'Hola' asks whether to publish and never starts the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].text, AUTO_REPLY_TEXT);
});

// B) sin conversación + "Sí" -> llama start exactamente una vez y responde
// con la primera pregunta REAL devuelta por el motor (mockeado).
test("B) no active conversation + 'Sí' calls EventCreationEngine.start exactly once and relays its real first question", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "Sí", from: "5491100001111" }), deps);

    assert.equal(deps.startConversation.calls.length, 1);
    assert.deepEqual(deps.startConversation.calls[0][0], { clerkId: "user_123", channel: "WHATSAPP", channelRef: "5491100001111" });
    assert.equal(sendCalls[0].text, "¿Cómo se llama tu evento?");
});

// C) sin conversación + "No" -> NO llama start, responde el mensaje de cierre.
test("C) no active conversation + 'No' never starts the engine and sends the closing message", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "No gracias" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_DECLINE_TEXT);
});

// D) sin conversación + intención desconocida -> pide Sí/No, no inicia el motor.
test("D) no active conversation + unknown intent re-asks instead of starting the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "asdkjh" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls[0].text, AUTO_REPLY_TEXT);
});

// E) con conversación activa + texto -> NO muestra el saludo, llama handleInput.
test("E) an active conversation skips the greeting entirely and routes straight into handleInput", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123" }) });

    await processInboundMessage(textMessage({ text: "Mi evento genial" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Mi evento genial" }]);
    assert.equal(sendCalls[0].text, "¿De qué trata tu evento?");
});

// F) conversación activa + "Sí" -> se trata como input del motor, nunca vuelve a llamar start.
test("F) 'Sí' with an active conversation is treated as plain input, never re-triggers start", async () => {
    const { deps } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123" }) });

    await processInboundMessage(textMessage({ text: "Sí" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0][1], { value: "Sí" });
});

// G) cancelar con conversación activa -> llama a EventCreationEngine.cancel.
test("G) 'cancelar' with an active conversation calls EventCreationEngine.cancel and confirms it", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123" }) });

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.deepEqual(deps.cancelConversation.calls[0], ["conv1", "user_123"]);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_CANCEL_TEXT);
});

// H) un error del motor nunca escapa de processInboundMessage (el webhook sigue en 200).
test("H) an EventCreationEngine failure never throws out of processInboundMessage", async () => {
    const { deps: depsStartThrows } = baseDeps({ startConversation: spy(new Error("engine boom")) });
    await assert.doesNotReject(() => processInboundMessage(textMessage({ text: "Sí" }), depsStartThrows));

    const { deps: depsLookupThrows } = baseDeps({ findActiveConversation: spy(new Error("db unavailable")) });
    await assert.doesNotReject(() => processInboundMessage(textMessage({ text: "hola" }), depsLookupThrows));
});

// I) dos mensajes de WhatsApp en el mismo payload se procesan de forma controlada.
test("I) two inbound messages in the same payload are processed independently, each starting its own conversation", async () => {
    const { sendText, calls: sendCalls } = fakeSender();
    const deps = {
        sendText,
        findActiveConversation: spy(null),
        startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" } }),
        handleConversationInput: spy(null),
        cancelConversation: spy(undefined),
        resolveOrganizerIdentity: spy({ clerkId: "user_123" }),
    };
    const messages = [
        textMessage({ messageId: "wamid.IN1", from: "5491100000001", text: "Sí" }),
        textMessage({ messageId: "wamid.IN2", from: "5491100000002", text: "Sí" }),
    ];

    await processInboundMessages(messages, deps);

    assert.equal(deps.startConversation.calls.length, 2);
    assert.deepEqual(
        deps.startConversation.calls.map((call) => call[0].channelRef).sort(),
        ["5491100000001", "5491100000002"]
    );
    assert.equal(sendCalls.length, 2);
});

// J) mensajes no-text no entran al motor todavía.
test("J) a non-text message never reaches the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ type: "image", text: null }), deps);

    assert.equal(deps.findActiveConversation.calls.length, 0);
    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

// L) Fase 2F, test A del pedido: waId no vinculado + "Sí" -> genera
// challenge, NUNCA inicia el motor con una identidad inventada.
test("L) with no verified wa_id link, the bot creates a link challenge instead of starting the engine", async () => {
    const { deps, sendCalls } = baseDeps({ resolveOrganizerIdentity: spy(null) });

    await processInboundMessage(textMessage({ text: "Sí", from: "5491100002222" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.createLinkChallenge.calls.length, 1);
    assert.deepEqual(deps.createLinkChallenge.calls[0], ["5491100002222"]);
    assert.equal(sendCalls[0].text, buildWhatsappLinkChallengeText("482731"));
});

// Fase 2F, test B/complemento: si ya hay un challenge vigente en cooldown
// (createLinkChallenge devuelve {pending:true}, ver
// shouldCreateNewChallenge), el bot avisa que ya se mandó un código en vez
// de generar uno nuevo — y sigue sin iniciar el motor.
test("when a link challenge is already pending, the bot asks the user to check their messages instead of generating a new code", async () => {
    const { deps, sendCalls } = baseDeps({ resolveOrganizerIdentity: spy(null), createLinkChallenge: spy({ pending: true }) });

    await processInboundMessage(textMessage({ text: "dale" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_LINK_CHALLENGE_PENDING_TEXT);
});

// Cobertura adicional de Fase 2D.1 que sigue vigente: el destinatario de
// salida (`to`) se normaliza sólo con WHATSAPP_TEST_MODE=true, pero
// channelRef (con qué conversación arranca/sigue el motor) usa siempre el
// wa_id crudo, nunca el normalizado.
test("outbound recipient normalization (WHATSAPP_TEST_MODE) never affects which conversation/channelRef is used", async () => {
    const previousTestMode = process.env.WHATSAPP_TEST_MODE;
    process.env.WHATSAPP_TEST_MODE = "true";

    const { deps, sendCalls } = baseDeps();

    try {
        await processInboundMessage(textMessage({ text: "Sí", from: "5492984405532" }), deps);
    } finally {
        if (previousTestMode === undefined) delete process.env.WHATSAPP_TEST_MODE;
        else process.env.WHATSAPP_TEST_MODE = previousTestMode;
    }

    assert.equal(deps.startConversation.calls[0][0].channelRef, "5492984405532");
    assert.equal(sendCalls[0].to, "542984405532");
});
