import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    parseWhatsappCompactDateTimeText,
    WHATSAPP_FUNCTION_CARD_DATE_TIME_PROMPT_TEXT,
    buildWhatsappCompactDateTimeInvalidText,
    WHATSAPP_COMPACT_DATE_TIME_PAST_TEXT,
    WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3K — FUNCTIONS_SINGLE_CARD deja de ser un sub-flujo de 3 preguntas
// (fecha -> hora inicio -> hora fin, con WhatsappPendingStepInput) para
// pasar a UN solo mensaje compacto ("26/08, 20:00-22:00",
// parseWhatsappCompactDateTimeText). Reemplaza por completo el archivo
// anterior (que testeaba el sub-flujo de 3 pasos, ya eliminado de
// whatsapp.controller.js): ya no hace falta ningún store de pending para
// este step — cada intercambio es atómico.

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

function sequentialSpy(returnValues) {
    const calls = [];
    let i = 0;
    const fn = async (...args) => {
        calls.push(args);
        const value = returnValues[Math.min(i, returnValues.length - 1)];
        i += 1;
        if (value instanceof Error) throw value;
        return typeof value === "function" ? value(...args) : value;
    };
    fn.calls = calls;
    return fn;
}

const FUNCTION_CARD_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "Contame cuándo es la función." },
    canGoBack: true,
    sections: [],
};

function baseDeps({ resumeConversation, handleConversationInput, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: resumeConversation ?? spy(FUNCTION_CARD_STEP_STATE),
            handleConversationInput: handleConversationInput ?? spy(FUNCTION_CARD_STEP_STATE),
            cancelConversation: spy(undefined),
            getPendingStepInput: spy(null),
            resetPendingStepInput: spy(undefined),
            updatePendingStepInputStatus: spy(undefined),
            deletePendingStepInput: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

const FUTURE_COMPACT_TEXT = "25/08/2099, 20:00-22:00";
const FUTURE_DATE_NORMALIZED = "2099-08-25";

function functionsListAcceptedWithSlot(slot) {
    return {
        conversationId: "conv1",
        prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [slot] },
    };
}

const PRICING_TYPE_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿El evento es gratuito o pago?" },
};

// ==================================================
// parser puro
// ==================================================

test("parseWhatsappCompactDateTimeText parses the taught format 'DD/MM, HH:MM-HH:MM'", () => {
    assert.deepEqual(parseWhatsappCompactDateTimeText(FUTURE_COMPACT_TEXT), {
        date: FUTURE_DATE_NORMALIZED,
        startTime: "20:00",
        endTime: "22:00",
    });
});

test("parseWhatsappCompactDateTimeText tolerates natural variants: no comma, extra spaces, 'a' instead of '-', 'hs', no minutes", () => {
    assert.deepEqual(parseWhatsappCompactDateTimeText("25/08/2099 20:00-22:00"), { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" });
    assert.deepEqual(parseWhatsappCompactDateTimeText("25/08/2099, 20:00 - 22:00"), { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" });
    assert.deepEqual(parseWhatsappCompactDateTimeText("25/08/2099, 20 a 22"), { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" });
    assert.deepEqual(parseWhatsappCompactDateTimeText("25/08/2099, 20hs a 22hs"), { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" });
});

test("parseWhatsappCompactDateTimeText accepts DD/MM without year, and never throws on non-string input", () => {
    const now = new Date("2026-08-12T15:00:00.000Z");
    assert.deepEqual(parseWhatsappCompactDateTimeText("26/08, 20:00-22:00", now), { date: "2026-08-26", startTime: "20:00", endTime: "22:00" });
    assert.equal(parseWhatsappCompactDateTimeText(null), null);
    assert.equal(parseWhatsappCompactDateTimeText(undefined), null);
});

for (const invalid of ["25/08/2099", "20:00-22:00", "no sé", "", "25/08/2099, hola"]) {
    test(`parseWhatsappCompactDateTimeText rejects "${invalid}"`, () => {
        assert.equal(parseWhatsappCompactDateTimeText(invalid), null);
    });
}

// ==================================================
// landing on FUNCTIONS_SINGLE_CARD for the first time
// ==================================================

test("landing on FUNCTIONS_SINGLE_CARD for the first time shows the new compact date+time prompt", async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "SINGLE", label: "Una sola función" }] },
        }),
        handleConversationInput: spy(FUNCTION_CARD_STEP_STATE),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_TIME_PROMPT_TEXT);
    assert.ok(sendCalls[0].text.includes("DD/MM, HH:MM-HH:MM"));
    assert.ok(sendCalls[0].text.includes("26/08, 20:00-22:00"));
});

// ==================================================
// camino feliz — un solo mensaje, dos llamadas al motor en cadena
// (FUNCTIONS_SINGLE_CARD, y automáticamente FUNCTIONS_LIST con el slot
// que el motor ya generó — mismo mecanismo que RECURRING/SCHEDULES).
// ==================================================

test("a valid compact message calls the engine exactly twice: once for FUNCTIONS_SINGLE_CARD, once for FUNCTIONS_LIST with the auto-generated slot", async () => {
    const generatedSlot = { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" };
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([functionsListAcceptedWithSlot(generatedSlot), PRICING_TYPE_RESULT]),
    });

    await processInboundMessage(textMessage({ text: FUTURE_COMPACT_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: generatedSlot }]);
    assert.deepEqual(deps.handleConversationInput.calls[1], ["conv1", { value: [generatedSlot] }]);
    assert.equal(sendCalls[0].text, "¿El evento es gratuito o pago?");
});

test("a malformed compact message never calls the engine, explains the taught format with a real example", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "no sé cuándo es" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, buildWhatsappCompactDateTimeInvalidText());
});

test("a past date is rejected without ever calling the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "01/01/2000, 20:00-22:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_COMPACT_DATE_TIME_PAST_TEXT);
});

test("if the engine rejects the parsed object, a clear recoverable message is shown, the message is never lost silently", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "x", error: "algo inesperado" },
        }),
    });

    await processInboundMessage(textMessage({ text: FUTURE_COMPACT_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1, "nunca se intenta el auto-commit de FUNCTIONS_LIST si el primer paso ya falló");
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT);
});

test("if the auto-commit to FUNCTIONS_LIST is rejected (defensive path), a clear recoverable message is shown", async () => {
    const generatedSlot = { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" };
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([
            functionsListAcceptedWithSlot(generatedSlot),
            { conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "x", error: "algo inesperado" } },
        ]),
    });

    await processInboundMessage(textMessage({ text: FUTURE_COMPACT_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT);
});

// ==================================================
// volver — único sub-paso: BACK real del motor, vuelve a FUNCTIONS_MODE.
// ==================================================

test("'volver' on FUNCTIONS_SINGLE_CARD uses the engine's real BACK, returning to FUNCTIONS_MODE", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: {
                stepId: "FUNCTIONS_MODE",
                type: "QUESTION",
                inputType: "SINGLE_SELECT",
                text: "¿Cómo se realizarán las funciones de este evento?",
                options: [{ id: "SINGLE", label: "Una sola función" }],
            },
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.ok(sendCalls[0].text.includes("¿Este evento ocurre una sola vez o se repite?"));
});

test("'VOLVER' (case-insensitive) also triggers the real BACK", async () => {
    const { deps } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "SINGLE", label: "Una sola función" }] },
        }),
    });

    await processInboundMessage(textMessage({ text: " VOLVER " }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
});

// ==================================================
// no se intercepta fuera del step, ni pending viejo interfiere
// ==================================================

test("a text message while the engine is not on FUNCTIONS_SINGLE_CARD is never intercepted by this sub-flow", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" },
        }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", options: [] } }),
    });

    await processInboundMessage(textMessage({ text: "Fiesta Aniversario" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Fiesta Aniversario" }]);
});

test("cancelling never calls the FUNCTIONS_SINGLE_CARD machinery — cancelConversation runs first and short-circuits", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.includes("Cancelamos"));
});

// ==================================================
// persistencia entre webhooks — sin pending, cada mensaje es
// completamente independiente (nada que "sobrevivir": ya no hay estado
// intermedio para este step).
// ==================================================

test("the single-message flow works identically across independent processInboundMessage calls (simulated separate webhooks)", async () => {
    const generatedSlot = { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" };
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([functionsListAcceptedWithSlot(generatedSlot), PRICING_TYPE_RESULT]),
    });

    await processInboundMessage(textMessage({ text: FUTURE_COMPACT_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.equal(sendCalls[0].text, "¿El evento es gratuito o pago?");
});
