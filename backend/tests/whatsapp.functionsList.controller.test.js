import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT,
    WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT,
    WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT,
    WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT,
    buildWhatsappFunctionAddedSummaryText,
    buildWhatsappCompactDateTimeInvalidText,
    WHATSAPP_COMPACT_DATE_TIME_PAST_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3K — FUNCTIONS_LIST (modo MULTIPLE de FUNCTIONS_MODE, "varias
// funciones") deja de ser un sub-flujo de 4 sub-estados (fecha -> hora
// inicio -> hora fin -> ¿agregar otra?) para pasar a sólo 2
// (AWAITING_DATE_TIME / AWAITING_ADD_ANOTHER): cada función se carga en UN
// mensaje compacto ("26/08, 20:00-22:00", parseWhatsappCompactDateTimeText).
// Reemplaza por completo el archivo anterior.

function createFakePendingStore(seed = null) {
    const rows = new Map();
    if (seed) rows.set(seed.conversationId, { ...seed });

    const calls = { get: [], reset: [], update: [], delete: [] };

    return {
        calls,
        getPendingStepInput: async (conversationId) => {
            calls.get.push(conversationId);
            return rows.get(conversationId) ?? null;
        },
        resetPendingStepInput: async (conversationId, stepId, status, partialData = {}) => {
            calls.reset.push({ conversationId, stepId, status, partialData });
            const row = { id: `pending_${conversationId}`, conversationId, stepId, status, partialData };
            rows.set(conversationId, row);
            return row;
        },
        updatePendingStepInputStatus: async (conversationId, status, partialData) => {
            calls.update.push({ conversationId, status, partialData });
            const existing = rows.get(conversationId);
            const updated = { ...existing, status, partialData };
            rows.set(conversationId, updated);
            return updated;
        },
        deletePendingStepInput: async (conversationId) => {
            calls.delete.push(conversationId);
            rows.delete(conversationId);
        },
    };
}

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

const FUNCTIONS_LIST_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [] },
    canGoBack: true,
    sections: [],
};

const PRICING_TYPE_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿El evento es gratuito o pago?" },
    canGoBack: true,
    sections: [],
};

function baseDeps({ pendingStore, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    const store = pendingStore ?? createFakePendingStore();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: spy(FUNCTIONS_LIST_STEP_STATE),
            handleConversationInput: spy(PRICING_TYPE_RESULT),
            cancelConversation: spy(undefined),
            getPendingStepInput: store.getPendingStepInput,
            resetPendingStepInput: store.resetPendingStepInput,
            updatePendingStepInputStatus: store.updatePendingStepInputStatus,
            deletePendingStepInput: store.deletePendingStepInput,
            ...overrides,
        },
        sendCalls,
        store,
    };
}

const FN_A_TEXT = "25/08/2099, 20:00-23:00";
const FN_A = { date: "2099-08-25", startTime: "20:00", endTime: "23:00" };
const FN_B_TEXT = "26/08/2099, 21:00-23:30";
const FN_B = { date: "2099-08-26", startTime: "21:00", endTime: "23:30" };

// ==================================================
// Prompt inicial — la primera vez que el motor avanza a FUNCTIONS_LIST.
// ==================================================

test("landing on FUNCTIONS_LIST for the first time shows the compact first-function prompt, never the generic Web prompt", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "MULTIPLE", label: "Varias funciones" }] },
        }),
        handleConversationInput: spy(FUNCTIONS_LIST_STEP_STATE),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT);
    assert.ok(sendCalls[0].text.includes("DD/MM, HH:MM-HH:MM"));
    assert.ok(!sendCalls[0].text.includes("Administrador de Agenda"));
    assert.equal(store.calls.reset.length, 0, "el sub-flujo todavía no arrancó, arranca con la PRÓXIMA respuesta");
});

// ==================================================
// primer mensaje — sin pending, inicializa AWAITING_DATE_TIME y ya
// acumula la primera función en la MISMA llamada.
// ==================================================

test("first message on FUNCTIONS_LIST with no pending initializes AWAITING_DATE_TIME and accumulates the first function", async () => {
    const { deps, sendCalls, store } = baseDeps();

    await processInboundMessage(textMessage({ text: FN_A_TEXT }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_DATE_TIME",
        partialData: { functions: [] },
    });
    assert.equal(store.calls.update.length, 1);
    assert.equal(store.calls.update[0].status, "AWAITING_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, { functions: [FN_A] });
    assert.equal(sendCalls[0].text, buildWhatsappFunctionAddedSummaryText(FN_A));
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

for (const invalid of ["25/08/2099", "20:00-23:00", "no sé cuándo"]) {
    test(`an invalid/malformed compact message ("${invalid}") never advances the sub-flow`, async () => {
        const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_DATE_TIME", partialData: { functions: [] } });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalid }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, buildWhatsappCompactDateTimeInvalidText());
    });
}

test("a past date is rejected without ever advancing the sub-flow", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_DATE_TIME", partialData: { functions: [] } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "01/01/2000, 20:00-22:00" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_COMPACT_DATE_TIME_PAST_TEXT);
});

// ==================================================
// agregar otra / finalizar.
// ==================================================

test('answering "1" (add another) starts a second function with the "próxima" prompt, keeping the first one', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_ADD_ANOTHER",
        partialData: { functions: [FN_A] },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_DATE_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { functions: [FN_A] });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT);
    assert.notEqual(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test('"si"/"sí" are also accepted (not just "1") to add another function', async () => {
    for (const text of ["si", "sí", "Sí"]) {
        const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_ADD_ANOTHER", partialData: { functions: [FN_A] } });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text }), deps);

        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT);
    }
});

test("completing a second function accumulates it after the first one, preserving order", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_DATE_TIME", partialData: { functions: [FN_A] } });
    const { deps } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: FN_B_TEXT }), deps);

    assert.deepEqual(store.calls.update[0].partialData, { functions: [FN_A, FN_B] });
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor NO se llama mientras se construye la segunda función");
});

test('an invalid reply while AWAITING_ADD_ANOTHER never advances and never modifies functions', async () => {
    const accumulated = [FN_A];
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_ADD_ANOTHER", partialData: { functions: accumulated } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "3" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.deepEqual(stillPending.partialData.functions, accumulated);
});

test('answering "2" (finish) calls the engine exactly once with the exact array of both functions, in order, and deletes the pending', async () => {
    const twoFunctions = [FN_A, FN_B];
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_ADD_ANOTHER", partialData: { functions: twoFunctions } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: twoFunctions }]);
    assert.equal(sendCalls[0].text, "¿El evento es gratuito o pago?");
    assert.equal(await store.getPendingStepInput("conv1"), null);
});

test("three consecutive functions can be loaded and finished, in the order they were entered", async () => {
    const store = createFakePendingStore();
    const FN_C_TEXT = "27/08/2099, 22:00-23:59";
    const FN_C = { date: "2099-08-27", startTime: "22:00", endTime: "23:59" };

    const { deps: d1, sendCalls: s1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: FN_A_TEXT }), d1);
    assert.ok(s1[0].text.startsWith("✅ Función agregada"));

    const { deps: dAdd1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "1" }), dAdd1);

    const { deps: d2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: FN_B_TEXT }), d2);

    const { deps: dAdd2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "1" }), dAdd2);

    const { deps: d3 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: FN_C_TEXT }), d3);

    const { deps: dFinish } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "2" }), dFinish);

    assert.deepEqual(dFinish.handleConversationInput.calls[0][1], { value: [FN_A, FN_B, FN_C] });
});

test("if the engine rejects the final array, the pending is NOT deleted and stays recoverable at AWAITING_ADD_ANOTHER", async () => {
    const accumulated = [FN_A];
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_ADD_ANOTHER", partialData: { functions: accumulated } });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "x", error: "algo inesperado" } }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(store.calls.delete.length, 0, "nunca se borra el pending ante un rechazo del motor");
    const stillPending = await store.getPendingStepInput("conv1");
    assert.equal(stillPending.status, "AWAITING_ADD_ANOTHER");
    assert.deepEqual(stillPending.partialData.functions, accumulated);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT);
});

// Sección 17 del pedido original — el motor no rechaza funciones
// duplicadas: WhatsApp tampoco agrega esa regla nueva.
test("two identical functions (same date/start/end) are both sent to the engine — WhatsApp never adds a duplicate rule the engine doesn't have", async () => {
    const duplicated = [FN_A, FN_A];
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_ADD_ANOTHER", partialData: { functions: duplicated } });
    const { deps } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0][1], { value: duplicated });
});

// ==================================================
// volver
// ==================================================

test('"volver" from AWAITING_DATE_TIME with confirmed functions returns to the add-another decision, without dropping the last confirmed function', async () => {
    const accumulated = [FN_A];
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_DATE_TIME", partialData: { functions: accumulated } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, { functions: accumulated });
    assert.equal(sendCalls[0].text, buildWhatsappFunctionAddedSummaryText(accumulated[0]));
    assert.equal(deps.handleConversationInput.calls.length, 0, "no usa el BACK real del motor: ya hay funciones cargadas");
});

test('"volver" from AWAITING_ADD_ANOTHER discards the last function and re-asks it from scratch', async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_ADD_ANOTHER", partialData: { functions: [FN_A, FN_B] } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_DATE_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { functions: [FN_A] });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT);
});

test('"volver" from the very first function\'s date+time uses the engine\'s real BACK, deletes the pending, and returns to FUNCTIONS_MODE', async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_DATE_TIME", partialData: { functions: [] } });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: {
                stepId: "FUNCTIONS_MODE",
                type: "QUESTION",
                inputType: "SINGLE_SELECT",
                text: "¿Cómo se realizarán las funciones de este evento?",
                options: [{ id: "MULTIPLE", label: "Varias funciones" }],
            },
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(store.calls.delete.length, 1);
    assert.ok(sendCalls[0].text.includes("¿Este evento ocurre una sola vez o se repite?"));
});

test('if the engine rejects the real BACK from the first function, the pending is kept intact', async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_DATE_TIME", partialData: { functions: [] } });
    const { deps } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", text: "x", error: "Ya estás en la primera pregunta." } }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.delete.length, 0);
    assert.ok(await store.getPendingStepInput("conv1"));
});

// ==================================================
// general
// ==================================================

test("cancelling never touches the FUNCTIONS_LIST pending store — cancelConversation runs first and short-circuits", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_DATE_TIME", partialData: { functions: [] } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.equal(store.calls.get.length, 0);
    assert.ok(sendCalls[0].text.includes("Cancelamos"));
});

test("a stale pending belonging to a different step is never reused — it gets reset for FUNCTIONS_LIST", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "CATEGORY", status: "SOME_OLD_STATUS", partialData: { whatever: true } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: FN_A_TEXT }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_DATE_TIME",
        partialData: { functions: [] },
    });
    assert.ok(sendCalls[0].text.startsWith("✅ Función agregada"));
});

test("a FUNCTIONS_LIST pending is never reused if the real current step is no longer FUNCTIONS_LIST", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_LIST", status: "AWAITING_ADD_ANOTHER", partialData: { functions: [FN_A] } });
    const { deps } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "MUSICA", label: "Música" }] },
        }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "2" }]);
});

test("the sub-flow survives being split across independent processInboundMessage calls (simulated separate webhooks)", async () => {
    const store = createFakePendingStore();

    const { deps: d1, sendCalls: s1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: FN_A_TEXT }), d1);
    assert.ok(s1[0].text.startsWith("✅ Función agregada"));
    assert.equal(d1.handleConversationInput.calls.length, 0);

    const { deps: d2, sendCalls: s2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "2" }), d2);
    assert.equal(d2.handleConversationInput.calls.length, 1);
    assert.deepEqual(d2.handleConversationInput.calls[0][1], { value: [FN_A] });
    assert.equal(s2[0].text, "¿El evento es gratuito o pago?");
});

test("a text message while the engine is not on FUNCTIONS_LIST is never intercepted by this sub-flow", async () => {
    const store = createFakePendingStore();
    const { deps } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" },
        }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", options: [] } }),
    });

    await processInboundMessage(textMessage({ text: "Fiesta Aniversario" }), deps);

    assert.equal(store.calls.reset.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Fiesta Aniversario" }]);
});
