import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { extractWhatsappReplyText, resolveWhatsappYesNoReply } from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3G, secciones 2/3/5 — steps YES_NO genéricos (WANTS_FREE_TICKETS,
// PROMO_VIDEO_ASK "YouTube", SOCIAL_LINKS_ASK "redes sociales",
// ADD_ANOTHER_SOCIAL): todos comparten el mismo inputType y el mismo
// mecanismo (tryHandleYesNoSubflow), sin WhatsappPendingStepInput (un solo
// intercambio). Se prueban PROMO_VIDEO_ASK y SOCIAL_LINKS_ASK explícitamente
// (los dos casos que pidió el ticket) más una prueba de que el mismo
// mecanismo cubre los otros dos steps YES_NO sin código adicional.

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.IN1",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "hola",
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

function promoVideoAskState(overrides = {}) {
    return {
        conversationId: "conv1",
        prompt: { stepId: "PROMO_VIDEO_ASK", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar un video promocional de YouTube?", ...overrides },
        canGoBack: true,
        sections: [],
    };
}

function socialLinksAskState(overrides = {}) {
    return {
        conversationId: "conv1",
        prompt: { stepId: "SOCIAL_LINKS_ASK", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar redes sociales?", ...overrides },
        canGoBack: true,
        sections: [],
    };
}

function baseDeps({ resumeConversation, handleConversationInput, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: resumeConversation ?? spy(promoVideoAskState()),
            handleConversationInput: handleConversationInput ?? spy(promoVideoAskState()),
            cancelConversation: spy(undefined),
            getPendingStepInput: spy(null),
            resetPendingStepInput: spy(null),
            updatePendingStepInputStatus: spy(null),
            deletePendingStepInput: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

// ==================================================
// resolveWhatsappYesNoReply — pura.
// ==================================================

test("resolveWhatsappYesNoReply: '1' -> true, '2' -> false, anything else -> null", () => {
    assert.equal(resolveWhatsappYesNoReply("1"), true);
    assert.equal(resolveWhatsappYesNoReply("2"), false);
    assert.equal(resolveWhatsappYesNoReply("sí"), null);
    assert.equal(resolveWhatsappYesNoReply("no"), null);
    assert.equal(resolveWhatsappYesNoReply("3"), null);
    assert.equal(resolveWhatsappYesNoReply(""), null);
});

// ==================================================
// extractWhatsappReplyText — el prompt YES_NO muestra 1/2 + VOLVER, nunca
// texto plano sin opciones.
// ==================================================

test("extractWhatsappReplyText shows '1. Sí / 2. No' and the VOLVER hint for a YES_NO prompt", () => {
    const text = extractWhatsappReplyText(promoVideoAskState());
    assert.ok(text.startsWith("¿Querés agregar un video promocional de YouTube?"));
    assert.ok(text.includes("1. Sí\n2. No"));
    assert.ok(text.includes("Respondé con el número de la opción."));
    assert.ok(text.includes("VOLVER"));
});

test("extractWhatsappReplyText prefixes the engine's error before the YES_NO question", () => {
    const text = extractWhatsappReplyText(promoVideoAskState({ error: 'Respondé "Sí" o "No".' }));
    assert.ok(text.startsWith('⚠️ Respondé "Sí" o "No".\n\n¿Querés agregar un video promocional de YouTube?'));
});

// ==================================================
// B. YouTube (PROMO_VIDEO_ASK)
// ==================================================

test("B. YouTube: '1' maps to boolean true and is sent to the engine, never the raw text", async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy(promoVideoAskState()),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "PROMO_VIDEO_URL", type: "QUESTION", inputType: "YOUTUBE_URL", text: "Pasame el link del video (video o Short de YouTube)." } }),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: true }]);
    assert.ok(sendCalls[0].text.startsWith("Pasame el link del video"));
});

test("B. YouTube: '2' maps to boolean false and is sent to the engine", async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy(promoVideoAskState()),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "SOCIAL_LINKS_ASK", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar redes sociales?" } }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: false }]);
    assert.ok(sendCalls[0].text.startsWith("¿Querés agregar redes sociales?"));
});

test("B. YouTube: 'volver' uses the engine's real BACK, never a fabricated navigation", async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy(promoVideoAskState()),
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "ADD_ANOTHER_TICKET", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Querés agregar otro tipo de entrada?", options: [{ id: "CONTINUE", label: "Continuar" }] },
        }),
    });

    await processInboundMessage(textMessage({ text: "VOLVER" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.ok(sendCalls[0].text.startsWith("¿Querés agregar otro tipo de entrada?"));
});

// ==================================================
// C. Redes sociales (SOCIAL_LINKS_ASK)
// ==================================================

test("C. Redes: '1' maps to boolean true", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy(socialLinksAskState()),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "SOCIAL_NETWORK", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Qué red querés agregar?", options: [{ id: "INSTAGRAM", label: "Instagram" }] } }),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: true }]);
});

test("C. Redes: '2' maps to boolean false", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy(socialLinksAskState()),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "x" } } }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: false }]);
});

test("C. Redes: 'volver' uses the engine's real BACK", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy(socialLinksAskState()),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "PROMO_VIDEO_ASK", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar un video promocional de YouTube?" } }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
});

test("C. Redes: written 'sí'/'no' still work as-is (compatibility, never reimplemented)", async () => {
    const { deps: depsYes } = baseDeps({
        resumeConversation: spy(socialLinksAskState()),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "SOCIAL_NETWORK", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Qué red querés agregar?", options: [] } }),
    });
    await processInboundMessage(textMessage({ text: "sí" }), depsYes);
    assert.deepEqual(depsYes.handleConversationInput.calls[0], ["conv1", { value: "sí" }]);

    const { deps: depsNo } = baseDeps({
        resumeConversation: spy(socialLinksAskState()),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "x" } } }),
    });
    await processInboundMessage(textMessage({ text: "no" }), depsNo);
    assert.deepEqual(depsNo.handleConversationInput.calls[0], ["conv1", { value: "no" }]);
});

// ==================================================
// Consistencia: el mismo mecanismo cubre WANTS_FREE_TICKETS y
// ADD_ANOTHER_SOCIAL sin código adicional (mismo inputType YES_NO).
// ==================================================

test("the same generic mechanism also covers WANTS_FREE_TICKETS and ADD_ANOTHER_SOCIAL (same inputType, no extra code)", async () => {
    const wantsFreeTicketsState = {
        conversationId: "conv1",
        prompt: { stepId: "WANTS_FREE_TICKETS", type: "QUESTION", inputType: "YES_NO", text: "¿Querés emitir entradas gratuitas para controlar el acceso?" },
        canGoBack: true,
        sections: [],
    };
    const { deps: deps1 } = baseDeps({
        resumeConversation: spy(wantsFreeTicketsState),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FREE_TICKET_QUANTITY", type: "QUESTION", inputType: "POSITIVE_INT", text: "¿Cuántas entradas gratuitas vas a emitir?" } }),
    });
    await processInboundMessage(textMessage({ text: "1" }), deps1);
    assert.deepEqual(deps1.handleConversationInput.calls[0], ["conv1", { value: true }]);

    const addAnotherSocialState = {
        conversationId: "conv1",
        prompt: { stepId: "ADD_ANOTHER_SOCIAL", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar otra red?" },
        canGoBack: true,
        sections: [],
    };
    const { deps: deps2 } = baseDeps({
        resumeConversation: spy(addAnotherSocialState),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "x" } } }),
    });
    await processInboundMessage(textMessage({ text: "2" }), deps2);
    assert.deepEqual(deps2.handleConversationInput.calls[0], ["conv1", { value: false }]);
});

test("a text message while the engine is not on a YES_NO step is never intercepted by this sub-flow", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" },
        }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "DESCRIPTION", type: "QUESTION", inputType: "SHORT_TEXT", text: "Contanos de qué trata tu evento." } }),
    });

    await processInboundMessage(textMessage({ text: "Fiesta Aniversario" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Fiesta Aniversario" }]);
});
