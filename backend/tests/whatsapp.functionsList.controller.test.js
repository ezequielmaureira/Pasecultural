import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT,
    WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT,
    WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT,
    WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT,
    buildWhatsappFunctionAddedSummaryText,
    WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT,
    WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT,
    WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3E — árbol de decisión de processInboundMessage para el sub-flujo
// conversacional de FUNCTIONS_LIST (modo MULTIPLE de FUNCTIONS_MODE, "varias
// funciones"): fecha -> hora de inicio -> hora de fin -> ¿agregar otra? ->
// repetir o finalizar. Mismo criterio de test que
// whatsapp.functionCard.controller.test.js (Fase 3C): un store en memoria
// que implementa el mismo contrato que whatsappPendingStepInput.service.js,
// ejercitando la orquestación completa incluida la persistencia entre
// llamadas independientes a processInboundMessage.

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

const NEXT_STEP_RESULT = {
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
            handleConversationInput: spy(NEXT_STEP_RESULT),
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

const DATE_A_TEXT = "25/08/2099";
const DATE_A = "2099-08-25";
const DATE_B_TEXT = "26/08/2099";
const DATE_B = "2099-08-26";
const DATE_C_TEXT = "27/08/2099";
const DATE_C = "2099-08-27";

// ==================================================
// 1/2) primer ingreso: no hay pending, el step real es FUNCTIONS_LIST — el
// prompt inicial ya se mostró vía extractWhatsappReplyText (test aparte,
// más abajo); acá el mensaje que llega ES la respuesta a esa pregunta.
// ==================================================

test("first message on FUNCTIONS_LIST with no pending initializes AWAITING_MULTIPLE_DATE and treats the message as the date answer", async () => {
    const { deps, sendCalls, store } = baseDeps();

    await processInboundMessage(textMessage({ text: DATE_A_TEXT }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
    assert.equal(store.calls.update.length, 1);
    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_START_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { functions: [], current: { date: DATE_A } });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// ==================================================
// 3/4/5/6/7/8) fecha: válida, inválida, inexistente, pasada, hoy, futura.
// ==================================================

test("a valid date advances to AWAITING_MULTIPLE_START_TIME with the date normalized to YYYY-MM-DD", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "01/12/2099" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_START_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { functions: [], current: { date: "2099-12-01" } });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
});

for (const invalidDate of ["31/02/2099", "32/08/2099", "00/08/2099", "no sé", "25/8/2099"]) {
    test(`an invalid/inexistent date ("${invalidDate}") never advances and never modifies partialData`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_LIST",
            status: "AWAITING_MULTIPLE_DATE",
            partialData: { functions: [], current: {} },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidDate }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT);
    });
}

test("a date before today (Argentina) is rejected as already past, never advances", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "01/01/2000" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT);
});

test("today's date (Argentina) is accepted as valid", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    const now = new Date();
    const todayDDMMYYYY = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${now.getUTCFullYear()}`;

    await processInboundMessage(textMessage({ text: todayDDMMYYYY }), deps);

    assert.notEqual(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT);
});

test("a future date is accepted as valid", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: DATE_A_TEXT }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
});

// ==================================================
// 9/10) hora de inicio válida/inválida.
// ==================================================

test("a valid start time advances to AWAITING_MULTIPLE_END_TIME, keeping the date already confirmed", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_START_TIME",
        partialData: { functions: [], current: { date: DATE_A } },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "20:00" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_END_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { functions: [], current: { date: DATE_A, startTime: "20:00" } });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

for (const invalidTime of ["8:00", "25:00", "20.30", "hola"]) {
    test(`an invalid start time ("${invalidTime}") never advances and never modifies partialData`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_LIST",
            status: "AWAITING_MULTIPLE_START_TIME",
            partialData: { functions: [], current: { date: DATE_A } },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidTime }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT);
    });
}

// ==================================================
// 11/12) hora de fin válida/inválida — completa la primera función y
// muestra el resumen "✅ Función agregada".
// ==================================================

for (const invalidEndTime of ["25:00", "21.00", "hola"]) {
    test(`an invalid end time ("${invalidEndTime}") never advances and never loses date/startTime`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_LIST",
            status: "AWAITING_MULTIPLE_END_TIME",
            partialData: { functions: [], current: { date: DATE_A, startTime: "20:00" } },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidEndTime }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT);
        const stillPending = await store.getPendingStepInput("conv1");
        assert.deepEqual(stillPending.partialData, { functions: [], current: { date: DATE_A, startTime: "20:00" } });
    });
}

// ==================================================
// 13/14) completar la primera función -> AWAITING_MULTIPLE_ADD_ANOTHER +
// resumen "✅ Función agregada".
// ==================================================

test("completing date+start+end for the first function shows the added-function summary and asks to add another", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_END_TIME",
        partialData: { functions: [], current: { date: DATE_A, startTime: "20:00" } },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "23:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor NO se llama tras la primera función individual");
    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, {
        functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }],
        current: {},
    });
    assert.equal(sendCalls[0].text, buildWhatsappFunctionAddedSummaryText({ date: DATE_A, startTime: "20:00", endTime: "23:00" }));
    assert.ok(sendCalls[0].text.startsWith("✅ Función agregada"));
    assert.ok(sendCalls[0].text.includes("25/08/2099"));
    assert.ok(sendCalls[0].text.includes("20:00 a 23:00"));
});

// ==================================================
// 15/16) responder "1" arranca la segunda función con el prompt de
// "siguiente función" (no el de "primera función").
// ==================================================

test('answering "1" (add another) starts a second function with the "siguiente función" prompt, keeping the first one', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: { functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }], current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_DATE");
    assert.deepEqual(store.calls.update[0].partialData, {
        functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }],
        current: {},
    });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT);
    assert.notEqual(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test('"si"/"sí" are also accepted (not just "1") to add another function', async () => {
    for (const text of ["si", "sí", "Sí"]) {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_LIST",
            status: "AWAITING_MULTIPLE_ADD_ANOTHER",
            partialData: { functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }], current: {} },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text }), deps);

        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT);
    }
});

// ==================================================
// 17) completar la segunda función completa -> AWAITING_MULTIPLE_ADD_ANOTHER
// con AMBAS funciones acumuladas, orden preservado.
// ==================================================

test("completing a second function accumulates it after the first one, preserving order", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_END_TIME",
        partialData: {
            functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }],
            current: { date: DATE_B, startTime: "21:00" },
        },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "23:30" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, {
        functions: [
            { date: DATE_A, startTime: "20:00", endTime: "23:00" },
            { date: DATE_B, startTime: "21:00", endTime: "23:30" },
        ],
        current: {},
    });
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor NO se llama mientras se construye la segunda función");
});

// ==================================================
// 18/19/20/21) responder "2" finaliza: el motor recibe EXACTAMENTE el
// array esperado, UNA sola vez, nunca antes.
// ==================================================

test('answering "2" (finish) calls the engine exactly once with the exact array of both functions, in order', async () => {
    const twoFunctions = [
        { date: DATE_A, startTime: "20:00", endTime: "23:00" },
        { date: DATE_B, startTime: "21:00", endTime: "23:30" },
    ];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: { functions: twoFunctions, current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: twoFunctions }]);
    assert.equal(sendCalls[0].text, "¿El evento es gratuito o pago?");
    assert.equal(await store.getPendingStepInput("conv1"), null, "el pending se elimina tras la aceptación del motor");
});

// ==================================================
// 22) tres funciones consecutivas — ciclo completo repetible N veces.
// ==================================================

test("three consecutive functions can be loaded and finished, in the order they were entered", async () => {
    const store = createFakePendingStore();

    const seq = [
        [DATE_A_TEXT, "20:00", "23:00"],
        [DATE_B_TEXT, "21:00", "23:30"],
        [DATE_C_TEXT, "22:00", "23:59"],
    ];

    for (let i = 0; i < seq.length; i++) {
        const [dateText, startTime, endTime] = seq[i];
        const { deps: d1 } = baseDeps({ pendingStore: store });
        await processInboundMessage(textMessage({ text: dateText }), d1);
        const { deps: d2 } = baseDeps({ pendingStore: store });
        await processInboundMessage(textMessage({ text: startTime }), d2);
        const { deps: d3 } = baseDeps({ pendingStore: store });
        await processInboundMessage(textMessage({ text: endTime }), d3);
        if (i < seq.length - 1) {
            const { deps: dAdd } = baseDeps({ pendingStore: store });
            await processInboundMessage(textMessage({ text: "1" }), dAdd);
        }
    }

    const { deps: dFinish } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "2" }), dFinish);

    assert.deepEqual(dFinish.handleConversationInput.calls[0][1], {
        value: [
            { date: DATE_A, startTime: "20:00", endTime: "23:00" },
            { date: DATE_B, startTime: "21:00", endTime: "23:30" },
            { date: DATE_C, startTime: "22:00", endTime: "23:59" },
        ],
    });
});

// ==================================================
// 23) respuesta inválida en "agregar otra" nunca modifica functions.
// ==================================================

test('an invalid reply while AWAITING_MULTIPLE_ADD_ANOTHER never advances and never modifies functions', async () => {
    const accumulated = [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: { functions: accumulated, current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "3" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.deepEqual(stillPending.partialData.functions, accumulated);
});

// ==================================================
// 24/25) "volver" desde hora fin / hora inicio.
// ==================================================

test('"volver" from AWAITING_MULTIPLE_END_TIME goes back to AWAITING_MULTIPLE_START_TIME, keeping date, dropping startTime', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_END_TIME",
        partialData: { functions: [], current: { date: DATE_A, startTime: "20:00" } },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_START_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { functions: [], current: { date: DATE_A } });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
});

test('"volver" from AWAITING_MULTIPLE_START_TIME goes back to AWAITING_MULTIPLE_DATE, keeping accumulated functions', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_START_TIME",
        partialData: { functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }], current: { date: DATE_B } },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "  Volver  " }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_DATE");
    assert.deepEqual(store.calls.update[0].partialData, {
        functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }],
        current: {},
    });
    // Ya hay una función anterior: el prompt de fecha debe ser el de
    // "siguiente función", no el de "primera función".
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT);
});

// ==================================================
// 26/27) "volver" desde la fecha de una función posterior / desde
// "agregar otra" — ambos vuelven a la decisión "¿agregar otra?" sin borrar
// la última función confirmada.
// ==================================================

test('"volver" from AWAITING_MULTIPLE_DATE of a later function returns to the add-another decision, without dropping the last confirmed function', async () => {
    const accumulated = [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: accumulated, current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, { functions: accumulated, current: {} });
    assert.equal(sendCalls[0].text, buildWhatsappFunctionAddedSummaryText(accumulated[0]));
    assert.equal(deps.handleConversationInput.calls.length, 0, "no usa el BACK real del motor: ya hay funciones cargadas");
});

// ==================================================
// 28) corrección de la última función mediante "volver" desde
// AWAITING_MULTIPLE_ADD_ANOTHER.
// ==================================================

test('"volver" from AWAITING_MULTIPLE_ADD_ANOTHER pulls the last function back into edition at AWAITING_MULTIPLE_END_TIME', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: {
            functions: [
                { date: DATE_A, startTime: "20:00", endTime: "23:00" },
                { date: DATE_B, startTime: "21:00", endTime: "23:30" },
            ],
            current: {},
        },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MULTIPLE_END_TIME");
    assert.deepEqual(store.calls.update[0].partialData, {
        functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }],
        current: { date: DATE_B, startTime: "21:00", endTime: "23:30" },
    });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);

    // Encadenado: seguir volviendo permite corregir hora inicio y fecha de
    // esa misma función sin reiniciar todo el flujo.
    const { deps: deps2, sendCalls: sendCalls2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "volver" }), deps2);
    assert.equal(store.calls.update[1].status, "AWAITING_MULTIPLE_START_TIME");
    assert.deepEqual(store.calls.update[1].partialData, {
        functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }],
        current: { date: DATE_B },
    });
    assert.equal(sendCalls2[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);

    const { deps: deps3, sendCalls: sendCalls3 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "volver" }), deps3);
    assert.equal(store.calls.update[2].status, "AWAITING_MULTIPLE_DATE");
    assert.deepEqual(store.calls.update[2].partialData, {
        functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }],
        current: {},
    });
    assert.equal(sendCalls3[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT);
});

// ==================================================
// 29) "volver" desde la fecha de la PRIMERA función usa el BACK real del
// motor (ningún sub-paso anterior dentro de este pending).
// ==================================================

test('"volver" from the very first function\'s date uses the engine\'s real BACK, deletes the pending, and returns to FUNCTIONS_MODE', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
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
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(store.calls.delete.length, 1);
    assert.ok(sendCalls[0].text.includes("¿Cómo se realizarán las funciones"));
});

// Mismo criterio que el test equivalente de FUNCTION_CARD/LOCATION: el
// mock del prompt rechazado omite `inputType` a propósito — con
// inputType:"FUNCTIONS_LIST" presente, extractWhatsappReplyText toma la
// rama especial de "primer prompt" y no expone prompt.error (comportamiento
// heredado, ya existente para FUNCTION_CARD/LOCATION, no introducido por
// esta fase) — lo que interesa probar acá es que el pending NUNCA se borra
// ante un BACK rechazado, no el texto exacto mostrado.
test('if the engine rejects the real BACK from the first date, the pending is kept intact', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
    const { deps } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", text: "x", error: "Ya estás en la primera pregunta." },
            canGoBack: false,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.delete.length, 0);
    assert.ok(await store.getPendingStepInput("conv1"));
});

// ==================================================
// 30) cancelar limpia conversación/pending — el chequeo ocurre ANTES del
// sub-flujo (mismo criterio que FUNCTION_CARD/LOCATION).
// ==================================================

test("cancelling never touches the FUNCTIONS_LIST pending store — cancelConversation runs first and short-circuits", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_START_TIME",
        partialData: { functions: [], current: { date: DATE_A } },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.equal(store.calls.get.length, 0);
    assert.equal(store.calls.update.length, 0);
    assert.ok(sendCalls[0].text.includes("Cancelamos"));
});

// ==================================================
// 31/32) pending viejo de otro step / de este mismo step con el step real
// ya cambiado nunca se reutiliza.
// ==================================================

test("a stale pending belonging to a different step is never reused — it gets reset for FUNCTIONS_LIST", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "CATEGORY",
        status: "SOME_OLD_STATUS",
        partialData: { whatever: true },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: DATE_A_TEXT }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_DATE",
        partialData: { functions: [], current: {} },
    });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
});

test("a FUNCTIONS_LIST pending is never reused if the real current step is no longer FUNCTIONS_LIST", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: { functions: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }], current: {} },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        // El organizador ya avanzó más allá (ej. volvió hacia FUNCTIONS_MODE
        // por otro camino) — el step real vigente ya no es FUNCTIONS_LIST.
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "MUSICA", label: "Música" }] },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    // Este mensaje nunca es interpretado como "finalizar funciones" — el
    // motor recibe el texto crudo, como cualquier otra respuesta normal.
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "2" }]);
});

// ==================================================
// 33/34) persistencia entre webhooks separados / deps completamente nuevas.
// ==================================================

test("the sub-flow survives being split across independent processInboundMessage calls (simulated separate webhooks)", async () => {
    const store = createFakePendingStore();

    const { deps: d1, sendCalls: s1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: DATE_A_TEXT }), d1);
    assert.equal(s1[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);

    const { deps: d2, sendCalls: s2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "20:00" }), d2);
    assert.equal(s2[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);

    const { deps: d3, sendCalls: s3 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "23:00" }), d3);
    assert.ok(s3[0].text.startsWith("✅ Función agregada"));
    assert.equal(d3.handleConversationInput.calls.length, 0);

    const { deps: d4, sendCalls: s4 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "2" }), d4);
    assert.equal(d4.handleConversationInput.calls.length, 1);
    assert.deepEqual(d4.handleConversationInput.calls[0][1], { value: [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }] });
    assert.equal(s4[0].text, "¿El evento es gratuito o pago?");
});

// ==================================================
// 35/36) rechazo del motor al array final conserva pending / éxito lo
// elimina.
// ==================================================

test("if the engine rejects the final array, the pending is NOT deleted and stays recoverable at AWAITING_MULTIPLE_ADD_ANOTHER", async () => {
    const accumulated = [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: { functions: accumulated, current: {} },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "x", error: "algo inesperado" },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(store.calls.delete.length, 0, "nunca se borra el pending ante un rechazo del motor");
    const stillPending = await store.getPendingStepInput("conv1");
    assert.equal(stillPending.status, "AWAITING_MULTIPLE_ADD_ANOTHER");
    assert.deepEqual(stillPending.partialData.functions, accumulated, "ninguna función cargada se pierde");
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT);
});

test("the pending is deleted after the engine accepts the final array", async () => {
    const accumulated = [{ date: DATE_A, startTime: "20:00", endTime: "23:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: { functions: accumulated, current: {} },
    });
    const { deps } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(store.calls.delete.length, 1);
    assert.equal(await store.getPendingStepInput("conv1"), null);
});

// ==================================================
// 41) comportamiento real de duplicados según auditoría: functionsList.js#parse
// NO rechaza fecha+horarios repetidos — el adaptador WhatsApp tampoco agrega
// esa restricción (sección 17 del pedido: nunca inventar una regla nueva).
// ==================================================

test("two identical functions (same date/start/end) are both sent to the engine — WhatsApp never adds a duplicate rule the engine doesn't have", async () => {
    const duplicated = [
        { date: DATE_A, startTime: "20:00", endTime: "23:00" },
        { date: DATE_A, startTime: "20:00", endTime: "23:00" },
    ];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_LIST",
        status: "AWAITING_MULTIPLE_ADD_ANOTHER",
        partialData: { functions: duplicated, current: {} },
    });
    const { deps } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0][1], { value: duplicated });
});

// ==================================================
// Prompt inicial — la primera vez que el motor avanza a FUNCTIONS_LIST
// (ej. al responder "Varias funciones" en FUNCTIONS_MODE), WhatsApp debe
// mostrar el prompt de "primera función", nunca el genérico de la Web
// ("Administrador de Agenda") ni pedir el array compuesto.
// ==================================================

test("landing on FUNCTIONS_LIST for the first time shows the new first-function date prompt, never the generic Web prompt", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        // Todavía en FUNCTIONS_MODE en el instante en que llega "2" (Varias
        // funciones) — el motor recién va a avanzar A FUNCTIONS_LIST como
        // resultado de esta respuesta.
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "MULTIPLE", label: "Varias funciones" }] },
            canGoBack: true,
            sections: [],
        }),
        handleConversationInput: spy(FUNCTIONS_LIST_STEP_STATE),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT);
    assert.equal(sendCalls[0].text, "📅 ¿Qué día es la primera función?\n\nEscribí la fecha así:\nDD/MM/AAAA\n\nEjemplo:\n25/08/2026");
    assert.ok(!sendCalls[0].text.includes("Administrador de Agenda"));
    assert.equal(store.calls.reset.length, 0, "el sub-flujo todavía no arrancó, arranca con la PRÓXIMA respuesta");
});

// ==================================================
// Regresión: un mensaje mientras el step real NO es FUNCTIONS_LIST nunca es
// interceptado por este sub-flujo.
// ==================================================

test("a text message while the engine is not on FUNCTIONS_LIST is never intercepted by this sub-flow", async () => {
    const store = createFakePendingStore();
    const { deps } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" },
            canGoBack: false,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "Fiesta Aniversario" }), deps);

    assert.equal(store.calls.reset.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Fiesta Aniversario" }]);
});
