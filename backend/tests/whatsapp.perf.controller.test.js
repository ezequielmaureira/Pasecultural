import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";

// Fase 3H — pruebas de ARQUITECTURA (no de milisegundos reales): prueban que
// la optimización "resumeConversation/getPendingStepInput una sola vez por
// mensaje" (ver informe de entrega, "N consultas por mensaje") efectivamente
// reduce el número de llamadas, sin depender de timings que varíen entre
// máquinas/CI. Antes de esta fase, un mensaje en un step "plano" (que ningún
// sub-flujo reclama) disparaba hasta 8 llamadas a resumeConversation y hasta
// 5 a getPendingStepInput para UN SOLO mensaje — ver los tests de abajo.

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
        return result;
    };
    return { sendText, calls };
}

function spy(returnValue) {
    const calls = [];
    const fn = async (...args) => {
        calls.push(args);
        return typeof returnValue === "function" ? returnValue(...args) : returnValue;
    };
    fn.calls = calls;
    return fn;
}

function stepState(stepId, inputType, extra = {}) {
    return {
        conversationId: "conv1",
        prompt: { stepId, type: "QUESTION", inputType, text: "x", ...extra },
        canGoBack: true,
        sections: [],
    };
}

function baseDeps({ resumeConversation, handleConversationInput, getPendingStepInput: getPendingStepInputOverride, ...overrides } = {}) {
    const { sendText } = fakeSender();
    return {
        sendText,
        findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
        resumeConversation: resumeConversation ?? spy(stepState("NAME", "SHORT_TEXT")),
        handleConversationInput: handleConversationInput ?? spy(stepState("DESCRIPTION", "SHORT_TEXT")),
        cancelConversation: spy(undefined),
        getPendingStepInput: getPendingStepInputOverride ?? spy(null),
        resetPendingStepInput: spy(null),
        updatePendingStepInputStatus: spy(null),
        deletePendingStepInput: spy(undefined),
        ...overrides,
    };
}

// ==================================================
// 1) Un step "plano" (NAME, SHORT_TEXT) que ningún sub-flujo reclama: antes,
// esto disparaba resumeConversation hasta 8 veces (una por cada
// tryHandle*Subflow) y getPendingStepInput hasta 5 veces. Ahora debe ser
// EXACTAMENTE una de cada (getPendingStepInput ni siquiera se llama: NAME no
// está en el set de steps que consumen WhatsappPendingStepInput).
// ==================================================

test("a plain SHORT_TEXT step (NAME) calls resumeConversation exactly once and never calls getPendingStepInput", async () => {
    const deps = baseDeps({
        resumeConversation: spy(stepState("NAME", "SHORT_TEXT")),
        handleConversationInput: spy(stepState("DESCRIPTION", "SHORT_TEXT")),
    });

    await processInboundMessage(textMessage({ text: "Fiesta Aniversario" }), deps);

    assert.equal(deps.resumeConversation.calls.length, 1, "resumeConversation debe llamarse UNA sola vez, no una por sub-flujo");
    assert.equal(deps.getPendingStepInput.calls.length, 0, "NAME no consume WhatsappPendingStepInput: no debería leerse");
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Fiesta Aniversario" }]);
});

// ==================================================
// 2) Un step YES_NO (no consume pending, pero SÍ es alcanzado recién en el
// 7° chequeo de los 8): resumeConversation sigue siendo UNA sola llamada, y
// getPendingStepInput sigue en cero.
// ==================================================

test("a YES_NO step (checked 7th out of 8 sub-flows) still calls resumeConversation exactly once, getPendingStepInput never", async () => {
    const deps = baseDeps({
        resumeConversation: spy(stepState("PROMO_VIDEO_ASK", "YES_NO")),
        handleConversationInput: spy(stepState("SOCIAL_LINKS_ASK", "YES_NO")),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(deps.resumeConversation.calls.length, 1);
    assert.equal(deps.getPendingStepInput.calls.length, 0);
});

// ==================================================
// 3) PREVIEW (el ÚLTIMO de los 8 chequeos): antes hubiera sido hasta 8
// resumeConversation + hasta 5 getPendingStepInput. Ahora sigue siendo 1/0.
// ==================================================

test("PREVIEW (checked last, 8th out of 8 sub-flows) still calls resumeConversation exactly once, getPendingStepInput never", async () => {
    const deps = baseDeps({
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "x", location: null, functions: [], ticketTypes: [] } },
            canGoBack: true,
            sections: [],
        }),
        handleConversationInput: spy({ conversationId: "conv1", done: true, status: "DRAFT_SAVED", event: { id: "evt1" } }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.resumeConversation.calls.length, 1);
    assert.equal(deps.getPendingStepInput.calls.length, 0);
});

// ==================================================
// 4) FUNCTIONS_RECURRING_SCHEDULES (el 5° de los 5 sub-flujos que SÍ
// consumen pending, y el 6° de los 8 en total): antes hubiera sido hasta 6
// resumeConversation + hasta 5 getPendingStepInput antes de llegar a su
// propio chequeo. Ahora sigue siendo exactamente 1/1.
// ==================================================

test("FUNCTIONS_RECURRING_SCHEDULES (checked 6th out of 8, 5th of the 5 pending-consuming steps) calls resumeConversation and getPendingStepInput exactly once each", async () => {
    const pendingRow = { id: "pending_conv1", conversationId: "conv1", stepId: "FUNCTIONS_RECURRING_SCHEDULES", status: "AWAITING_RECURRING_START_TIME", partialData: { schedules: [], current: {} } };
    const deps = baseDeps({
        resumeConversation: spy(stepState("FUNCTIONS_RECURRING_SCHEDULES", "TIME_RANGE_LIST")),
        getPendingStepInput: spy(pendingRow),
        handleConversationInput: spy(stepState("FUNCTIONS_LIST", "FUNCTIONS_LIST")),
    });

    await processInboundMessage(textMessage({ text: "20:00" }), deps);

    assert.equal(deps.resumeConversation.calls.length, 1, "1 sola lectura de ConversationState, no hasta 6");
    assert.equal(deps.getPendingStepInput.calls.length, 1, "1 sola lectura de WhatsappPendingStepInput, no hasta 5");
});

// ==================================================
// 5) LOCATION (el 1° de los 5 pending-consuming, y el 1° de los 8 en
// total): ya era 1/1 antes de esta fase (nada que optimizar ahí), sigue
// siendo 1/1 — regresión.
// ==================================================

test("LOCATION (checked 1st) still calls resumeConversation and getPendingStepInput exactly once each — no regression", async () => {
    const pendingRow = { id: "pending_conv1", conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_METHOD", partialData: {} };
    const deps = baseDeps({
        resumeConversation: spy(stepState("LOCATION", "LOCATION")),
        getPendingStepInput: spy(pendingRow),
        handleConversationInput: spy(stepState("LOCATION", "LOCATION")),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(deps.resumeConversation.calls.length, 1);
    assert.equal(deps.getPendingStepInput.calls.length, 1);
});

// ==================================================
// 6) "cancelar" sigue cortando ANTES de cualquier lectura — regresión.
// ==================================================

test("cancelling still short-circuits before any resumeConversation/getPendingStepInput read", async () => {
    const deps = baseDeps();

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.resumeConversation.calls.length, 0);
    assert.equal(deps.getPendingStepInput.calls.length, 0);
    assert.equal(deps.cancelConversation.calls.length, 1);
});
