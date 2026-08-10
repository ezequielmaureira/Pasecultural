import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { WHATSAPP_FUNCTION_CARD_PROMPT_TEXT, WHATSAPP_FUNCTION_CARD_RETRY_TEXT } from "../src/services/whatsappOrganizerBot.service.js";

// Bug fix (UX y validación de fecha) — árbol de decisión de
// processInboundMessage para el step FUNCTIONS_SINGLE_CARD (inputType
// FUNCTION_CARD). Mismo patrón DI y mismo mecanismo de reintento (primer
// intento con el texto crudo, reintento único si el motor lo rechaza) ya
// probado para SINGLE_SELECT — acá se prueba la variante FUNCTION_CARD.

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

const FUNCTION_CARD_ERROR_RESULT = {
    conversationId: "conv1",
    prompt: {
        stepId: "FUNCTIONS_SINGLE_CARD",
        type: "QUESTION",
        inputType: "FUNCTION_CARD",
        text: "Contame cuándo es la función.",
        error: "Necesito una fecha válida para la función.",
    },
    canGoBack: true,
    sections: [],
};

const NEXT_STEP_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [] },
    canGoBack: true,
    sections: [],
};

function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    const handleConversationInput = spy((_conversationId, { value }) => {
        // Simula functionCard.js#parse real: sólo un objeto {date,startTime,endTime}
        // con valores reales avanza; cualquier otra cosa (ej. texto crudo) repite
        // el mismo error, con el mismo prompt.
        const isValidObject = value && typeof value === "object" && value.date === "2026-08-25" && value.startTime === "20:00" && value.endTime === "23:00";
        return isValidObject ? NEXT_STEP_RESULT : FUNCTION_CARD_ERROR_RESULT;
    });
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            handleConversationInput,
            cancelConversation: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

test("a well-formed date+time text on the FUNCTION_CARD step is transformed and advances the engine exactly once", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "25/08/2026 20:00 a 23:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "25/08/2026 20:00 a 23:00" }]);
    assert.deepEqual(deps.handleConversationInput.calls[1], ["conv1", { value: { date: "2026-08-25", startTime: "20:00", endTime: "23:00" } }]);
    assert.equal(sendCalls[0].text, "Administrador de Agenda");
});

test("the WhatsApp-specific prompt (not the engine's generic Web text) is shown for the FUNCTION_CARD step", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "Contame cuándo es la función." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "cualquier cosa" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_PROMPT_TEXT);
    assert.ok(!sendCalls[0].text.includes("Contame cuándo es la función."));
});

test("31/02/2026 (fecha inexistente) never advances the engine — a single failed attempt, retry text shown", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "31/02/2026 20:00 a 23:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1, "el texto no matchea un date real -> no debe reintentar con nada inventado");
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_RETRY_TEXT);
});

test("32/08/2026 (día fuera de rango) never advances the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "32/08/2026 20:00 a 23:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_RETRY_TEXT);
});

test("arbitrary free text never advances the engine and shows the exact expected format", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "el próximo sábado a la tarde" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_RETRY_TEXT);
    assert.ok(sendCalls[0].text.includes("DD/MM/AAAA"));
});

test("an invalid reply is only ever retried once, never in a loop", async () => {
    const { deps } = baseDeps();

    await processInboundMessage(textMessage({ text: "no sé" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
});

test("a valid date/time reply reaches handleConversationInput exactly twice (raw attempt + one successful retry), never more", async () => {
    const { deps } = baseDeps();

    await processInboundMessage(textMessage({ text: "25/08/2026 20:00 a 23:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
});

test("a SINGLE_SELECT error on a different step is unaffected by the FUNCTION_CARD retry branch (mutually exclusive)", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", text: "Elegí la categoría de tu evento.", options: [{ id: "MUSICA", label: "Música" }], error: "Elegí una de las opciones que te muestro." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "25/08/2026 20:00 a 23:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1, "un índice/fecha nunca debe interpretarse como opción SINGLE_SELECT ni viceversa");
});
