import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    extractWhatsappReplyText,
    WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT,
    WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT,
    WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT,
    WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_START_TIME_NEXT_PROMPT_TEXT,
    WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_NO_OCCURRENCES_TEXT,
    buildWhatsappScheduleAddedSummaryText,
    buildWhatsappWeekdaysConfirmationText,
    parseWhatsappWeekdaySelection,
    isRecurringToBeforeFrom,
    WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT,
    WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT,
    WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT,
    WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3F — árbol de decisión de processInboundMessage para FUNCTIONS_MODE =
// RECURRING: tres steps reales del motor (FUNCTIONS_RANGE, FUNCTIONS_WEEKDAYS,
// FUNCTIONS_RECURRING_SCHEDULES), cada uno conversacional. Mismo criterio de
// test que las fases anteriores: un store en memoria con el mismo contrato
// que whatsappPendingStepInput.service.js.

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

// A diferencia de spy(), devuelve un valor DISTINTO por cada llamada
// (agotado el array, repite el último) — necesario para SCHEDULES, que en
// el camino feliz llama al motor DOS veces con respuestas distintas
// (FUNCTIONS_RECURRING_SCHEDULES y, automáticamente, FUNCTIONS_LIST).
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

const RANGE_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_RANGE", type: "QUESTION", inputType: "DATE_RANGE", text: "¿Desde y hasta qué fecha se repiten las funciones?" },
    canGoBack: true,
    sections: [],
};

const WEEKDAYS_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_WEEKDAYS", type: "QUESTION", inputType: "WEEKDAYS", text: "¿Qué días de la semana?" },
    canGoBack: true,
    sections: [],
};

const SCHEDULES_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_RECURRING_SCHEDULES", type: "QUESTION", inputType: "TIME_RANGE_LIST", text: "¿A qué horarios se hace la función esos días?" },
    canGoBack: true,
    sections: [],
};

function baseDeps({ pendingStore, resumeConversation, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    const store = pendingStore ?? createFakePendingStore();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: resumeConversation ?? spy(RANGE_STEP_STATE),
            handleConversationInput: spy(WEEKDAYS_STEP_STATE),
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

const FROM_TEXT = "20/08/2099";
const FROM = "2099-08-20";
const TO_TEXT = "30/09/2099";
const TO = "2099-09-30";

// ==================================================
// extractWhatsappReplyText — los tres inputTypes nuevos de RECURRING nunca
// muestran el texto genérico pensado para la Web.
// ==================================================

test("extractWhatsappReplyText shows the RECURRING-specific prompt for DATE_RANGE/WEEKDAYS/TIME_RANGE_LIST, never the generic Web text", () => {
    assert.equal(
        extractWhatsappReplyText({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_RANGE", type: "QUESTION", inputType: "DATE_RANGE", text: "¿Desde y hasta qué fecha se repiten las funciones?" },
        }),
        WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT
    );
    assert.equal(
        extractWhatsappReplyText({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_WEEKDAYS", type: "QUESTION", inputType: "WEEKDAYS", text: "¿Qué días de la semana?" },
        }),
        WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT
    );
    assert.equal(
        extractWhatsappReplyText({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_RECURRING_SCHEDULES", type: "QUESTION", inputType: "TIME_RANGE_LIST", text: "¿A qué horarios se hace la función esos días?" },
        }),
        WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT
    );
});

// ==================================================
// RANGE — fecha desde
// ==================================================

test("first message on FUNCTIONS_RANGE with no pending initializes AWAITING_RECURRING_FROM_DATE and treats the message as the from-date answer", async () => {
    const { deps, sendCalls, store } = baseDeps();

    await processInboundMessage(textMessage({ text: FROM_TEXT }), deps);

    assert.deepEqual(store.calls.reset[0], { conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_FROM_DATE", partialData: {} });
    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_TO_DATE");
    assert.deepEqual(store.calls.update[0].partialData, { from: FROM });
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

for (const invalidDate of ["31/02/2099", "32/08/2099", "00/08/2099", "no sé", "20/8/2099"]) {
    test(`an invalid/inexistent from-date ("${invalidDate}") never advances and never modifies partialData`, async () => {
        const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_FROM_DATE", partialData: {} });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidDate }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT);
    });
}

test("a from-date before today (Argentina) is rejected as already past", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_FROM_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "01/01/2000" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT);
});

test("a future from-date is accepted and asks for the to-date", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_FROM_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: FROM_TEXT }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT);
});

// ==================================================
// RANGE — fecha hasta
// ==================================================

for (const invalidDate of ["31/02/2099", "no sé", "30/9/2099"]) {
    test(`an invalid/inexistent to-date ("${invalidDate}") never advances and never calls the engine`, async () => {
        const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: FROM } });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidDate }), deps);

        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT);
    });
}

test("a to-date earlier than the from-date is rejected without ever calling the engine, keeping from intact", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: "2099-08-20" } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "10/08/2099" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.deepEqual(stillPending.partialData, { from: "2099-08-20" });
});

test("isRecurringToBeforeFrom is a pure comparator reused by the subflow", () => {
    assert.equal(isRecurringToBeforeFrom("2099-08-20", "2099-08-10"), true);
    assert.equal(isRecurringToBeforeFrom("2099-08-20", "2099-08-20"), false);
    assert.equal(isRecurringToBeforeFrom("2099-08-20", "2099-09-30"), false);
});

test("a to-date equal to from-date is accepted (same-day range)", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: FROM } });
    const { deps } = baseDeps({ pendingStore: store, handleConversationInput: spy(WEEKDAYS_STEP_STATE) });

    await processInboundMessage(textMessage({ text: FROM_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0][1], { value: { from: FROM, to: FROM } });
});

test("a valid to-date >= from calls the engine exactly once with the exact {from,to} object, then deletes the pending", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: FROM } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, handleConversationInput: spy(WEEKDAYS_STEP_STATE) });

    await processInboundMessage(textMessage({ text: TO_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: { from: FROM, to: TO } }]);
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT);
    assert.equal(await store.getPendingStepInput("conv1"), null);
});

test("if the engine rejects the final {from,to}, the pending is NOT deleted and stays recoverable at AWAITING_RECURRING_TO_DATE", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: FROM } });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_RANGE", type: "QUESTION", inputType: "DATE_RANGE", text: "x", error: "algo inesperado" } }),
    });

    await processInboundMessage(textMessage({ text: TO_TEXT }), deps);

    assert.equal(store.calls.delete.length, 0);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.deepEqual(stillPending.partialData, { from: FROM });
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT);
});

// ==================================================
// RANGE — volver
// ==================================================

test('"volver" from AWAITING_RECURRING_TO_DATE returns to AWAITING_RECURRING_FROM_DATE', async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: FROM } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "  Volver  " }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_FROM_DATE");
    assert.deepEqual(store.calls.update[0].partialData, {});
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT);
});

test('"volver" from the first from-date question uses the engine\'s real BACK and returns to FUNCTIONS_MODE', async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_FROM_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: {
                stepId: "FUNCTIONS_MODE",
                type: "QUESTION",
                inputType: "SINGLE_SELECT",
                text: "¿Cómo se realizarán las funciones de este evento?",
                options: [{ id: "RECURRING", label: "Funciones recurrentes" }],
            },
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(store.calls.delete.length, 1);
    assert.ok(sendCalls[0].text.includes("¿Cómo se realizarán las funciones"));
});

test('if the engine rejects the real BACK from the first from-date, the pending is kept intact', async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_FROM_DATE", partialData: {} });
    const { deps } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_RANGE", type: "QUESTION", text: "x", error: "Ya estás en la primera pregunta." } }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.delete.length, 0);
    assert.ok(await store.getPendingStepInput("conv1"));
});

// ==================================================
// WEEKDAYS — parser puro
// ==================================================

test("parseWhatsappWeekdaySelection accepts single/multiple indices, with or without spaces", () => {
    assert.deepEqual(parseWhatsappWeekdaySelection("1"), [0]);
    assert.deepEqual(parseWhatsappWeekdaySelection("1,3,5"), [0, 2, 4]);
    assert.deepEqual(parseWhatsappWeekdaySelection("1, 3, 5"), [0, 2, 4]);
});

test("parseWhatsappWeekdaySelection dedupes, preserving the order of first appearance", () => {
    assert.deepEqual(parseWhatsappWeekdaySelection("1,1,3"), [0, 2]);
    assert.deepEqual(parseWhatsappWeekdaySelection("5,1,5,3"), [4, 0, 2]);
});

for (const invalid of ["0", "8", "1,8", "hola", "lunes", "1,,3", "1.3.5", "", "  "]) {
    test(`parseWhatsappWeekdaySelection rejects "${invalid}"`, () => {
        assert.equal(parseWhatsappWeekdaySelection(invalid), null);
    });
}

test("buildWhatsappWeekdaysConfirmationText lists days in weekly order regardless of input order", () => {
    assert.equal(buildWhatsappWeekdaysConfirmationText([4, 0, 2]), "✅ Días seleccionados:\nLunes, Miércoles y Viernes");
    assert.equal(buildWhatsappWeekdaysConfirmationText([6]), "✅ Días seleccionados:\nDomingo");
});

// ==================================================
// WEEKDAYS — subflujo
// ==================================================

for (const invalid of ["0", "8", "1,8", "hola", "1,,3"]) {
    test(`an invalid weekday selection ("${invalid}") never calls the engine`, async () => {
        const { deps, sendCalls } = baseDeps({ resumeConversation: spy(WEEKDAYS_STEP_STATE) });

        await processInboundMessage(textMessage({ text: invalid }), deps);

        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT);
    });
}

test('a valid selection calls the engine exactly once with the mapped internal array (1=Monday -> 0), and shows the confirmation + next prompt', async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy(WEEKDAYS_STEP_STATE),
        handleConversationInput: spy(SCHEDULES_STEP_STATE),
    });

    await processInboundMessage(textMessage({ text: "1,3,5" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: [0, 2, 4] }]);
    assert.ok(sendCalls[0].text.includes("✅ Días seleccionados"));
    assert.ok(sendCalls[0].text.includes("Lunes, Miércoles y Viernes"));
    assert.equal(sendCalls[0].text, `${buildWhatsappWeekdaysConfirmationText([0, 2, 4])}\n\n${WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT}`);
});

test("if the engine rejects the weekday selection, a clear recoverable message is shown", async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy(WEEKDAYS_STEP_STATE),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_WEEKDAYS", type: "QUESTION", inputType: "WEEKDAYS", text: "x", error: "algo inesperado" } }),
    });

    await processInboundMessage(textMessage({ text: "1,3,5" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_WEEKDAYS_COMMIT_ERROR_TEXT);
});

test('"volver" from FUNCTIONS_WEEKDAYS uses the engine\'s real BACK, returning to FUNCTIONS_RANGE — no pending is ever created for this step', async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(WEEKDAYS_STEP_STATE),
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_RANGE", type: "QUESTION", inputType: "DATE_RANGE", text: "¿Desde y hasta qué fecha se repiten las funciones?" },
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT);
    // WEEKDAYS es un intercambio único: nunca crea/consulta un pending
    // propio (RANGE/SCHEDULES sí consultan el store al descartarse a sí
    // mismos, de ahí que store.calls.get no sea necesariamente 0).
    assert.equal(store.calls.reset.length, 0);
    assert.equal(store.calls.update.length, 0);
    assert.equal(store.calls.delete.length, 0);
});

test("a text message while the engine is not on FUNCTIONS_WEEKDAYS is never intercepted by this sub-flow", async () => {
    const { deps } = baseDeps({ resumeConversation: spy(RANGE_STEP_STATE) });

    // "1,3,5" nunca debería llegar a interpretarse como selección de días
    // si el step real es RANGE — se procesa como un intento de fecha (la
    // primera vez, sin pending, inicializa AWAITING_RECURRING_FROM_DATE).
    await processInboundMessage(textMessage({ text: "1,3,5" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// ==================================================
// SCHEDULES — hora inicio / hora fin
// ==================================================

test("first message on FUNCTIONS_RECURRING_SCHEDULES with no pending initializes AWAITING_RECURRING_START_TIME and treats the message as the start-time answer", async () => {
    const { deps, sendCalls, store } = baseDeps({ resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "20:00" }), deps);

    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_START_TIME",
        partialData: { schedules: [], current: {} },
    });
    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_END_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { schedules: [], current: { startTime: "20:00" } });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

for (const invalidTime of ["8:00", "25:00", "20.30", "hola"]) {
    test(`an invalid start time ("${invalidTime}") never advances the schedules sub-flow`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_RECURRING_SCHEDULES",
            status: "AWAITING_RECURRING_START_TIME",
            partialData: { schedules: [], current: {} },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

        await processInboundMessage(textMessage({ text: invalidTime }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT);
    });
}

test("completing start+end for the first schedule shows the added-schedule summary and asks to add another", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_END_TIME",
        partialData: { schedules: [], current: { startTime: "20:00" } },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "22:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor NO se llama tras el primer horario individual");
    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, { schedules: [{ startTime: "20:00", endTime: "22:00" }], current: {} });
    assert.equal(sendCalls[0].text, buildWhatsappScheduleAddedSummaryText({ startTime: "20:00", endTime: "22:00" }));
    assert.ok(sendCalls[0].text.startsWith("✅ Horario agregado"));
});

for (const invalidEndTime of ["25:00", "21.00", "hola"]) {
    test(`an invalid end time ("${invalidEndTime}") never advances and never loses startTime`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_RECURRING_SCHEDULES",
            status: "AWAITING_RECURRING_END_TIME",
            partialData: { schedules: [], current: { startTime: "20:00" } },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

        await processInboundMessage(textMessage({ text: invalidEndTime }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT);
        const stillPending = await store.getPendingStepInput("conv1");
        assert.deepEqual(stillPending.partialData, { schedules: [], current: { startTime: "20:00" } });
    });
}

// ==================================================
// SCHEDULES — agregar otro / finalizar
// ==================================================

test('"1" (add another) starts a second schedule with the "siguiente horario" prompt', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_ADD_ANOTHER",
        partialData: { schedules: [{ startTime: "20:00", endTime: "22:00" }], current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_START_TIME");
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_START_TIME_NEXT_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test("completing a second schedule accumulates it after the first one, preserving order", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_END_TIME",
        partialData: { schedules: [{ startTime: "20:00", endTime: "22:00" }], current: { startTime: "23:00" } },
    });
    const { deps } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "01:00" }), deps);

    assert.deepEqual(store.calls.update[0].partialData, {
        schedules: [
            { startTime: "20:00", endTime: "22:00" },
            { startTime: "23:00", endTime: "01:00" },
        ],
        current: {},
    });
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor NO se llama mientras se construye el segundo horario");
});

test('an invalid reply while AWAITING_RECURRING_ADD_ANOTHER never advances and never modifies schedules', async () => {
    const accumulated = [{ startTime: "20:00", endTime: "22:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_ADD_ANOTHER",
        partialData: { schedules: accumulated, current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "3" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.deepEqual(stillPending.partialData.schedules, accumulated);
});

// "2" (finish): dos llamadas al motor en cadena — SCHEDULES, y
// automáticamente FUNCTIONS_LIST con los slots ya generados por
// generateRecurringSlots (ver comentario de tryHandleRecurringSchedulesSubflow).
test('"2" (finish) calls the engine exactly twice: once for SCHEDULES with the exact array, once for FUNCTIONS_LIST with the slots the engine already generated', async () => {
    const twoSchedules = [
        { startTime: "20:00", endTime: "22:00" },
        { startTime: "23:00", endTime: "01:00" },
    ];
    const generatedSlots = [
        { date: "2099-08-20", startTime: "20:00", endTime: "22:00" },
        { date: "2099-08-20", startTime: "23:00", endTime: "01:00" },
        { date: "2099-08-27", startTime: "20:00", endTime: "22:00" },
        { date: "2099-08-27", startTime: "23:00", endTime: "01:00" },
    ];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_ADD_ANOTHER",
        partialData: { schedules: twoSchedules, current: {} },
    });
    const schedulesAccepted = {
        conversationId: "conv1",
        prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: generatedSlots },
    };
    const functionsListAccepted = {
        conversationId: "conv1",
        prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿El evento es gratuito o pago?" },
    };
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(SCHEDULES_STEP_STATE),
        handleConversationInput: sequentialSpy([schedulesAccepted, functionsListAccepted]),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: twoSchedules }]);
    assert.deepEqual(deps.handleConversationInput.calls[1], ["conv1", { value: generatedSlots }]);
    assert.equal(sendCalls[0].text, "¿El evento es gratuito o pago?");
    assert.equal(await store.getPendingStepInput("conv1"), null);
});

test("if the engine rejects the final schedules array, the pending is NOT deleted and the engine is never called for FUNCTIONS_LIST", async () => {
    const accumulated = [{ startTime: "20:00", endTime: "22:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_ADD_ANOTHER",
        partialData: { schedules: accumulated, current: {} },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(SCHEDULES_STEP_STATE),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_RECURRING_SCHEDULES", type: "QUESTION", inputType: "TIME_RANGE_LIST", text: "x", error: "algo inesperado" } }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(store.calls.delete.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.deepEqual(stillPending.partialData.schedules, accumulated);
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT);
});

// Sección 25 — rango sin ocurrencias: el motor lo detecta (FUNCTIONS_LIST
// rechazaría un array vacío) — se evita esa llamada y se da un mensaje
// claro y recuperable directamente.
test("if the generated slots array is empty, FUNCTIONS_LIST is never called and a clear recoverable message is shown", async () => {
    const accumulated = [{ startTime: "20:00", endTime: "22:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_ADD_ANOTHER",
        partialData: { schedules: accumulated, current: {} },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(SCHEDULES_STEP_STATE),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [] } }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1, "nunca se llama a FUNCTIONS_LIST con un array vacío");
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_NO_OCCURRENCES_TEXT);
    assert.equal(await store.getPendingStepInput("conv1"), null, "el pending de SCHEDULES ya no corresponde: el step real avanzó a FUNCTIONS_LIST");
});

// ==================================================
// SCHEDULES — volver
// ==================================================

test('"volver" from AWAITING_RECURRING_END_TIME goes back to AWAITING_RECURRING_START_TIME, keeping confirmed schedules', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_END_TIME",
        partialData: { schedules: [{ startTime: "20:00", endTime: "22:00" }], current: { startTime: "23:00" } },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_START_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { schedules: [{ startTime: "20:00", endTime: "22:00" }], current: {} });
    // Ya hay un horario confirmado: el prompt debe ser el de "siguiente horario".
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_START_TIME_NEXT_PROMPT_TEXT);
});

test('"volver" from AWAITING_RECURRING_START_TIME with confirmed schedules returns to the add-another decision', async () => {
    const accumulated = [{ startTime: "20:00", endTime: "22:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_START_TIME",
        partialData: { schedules: accumulated, current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, { schedules: accumulated, current: {} });
    assert.equal(sendCalls[0].text, buildWhatsappScheduleAddedSummaryText(accumulated[0]));
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test('"volver" from AWAITING_RECURRING_ADD_ANOTHER pulls the last schedule back into edition at AWAITING_RECURRING_END_TIME', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_ADD_ANOTHER",
        partialData: {
            schedules: [
                { startTime: "20:00", endTime: "22:00" },
                { startTime: "23:00", endTime: "01:00" },
            ],
            current: {},
        },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_RECURRING_END_TIME");
    assert.deepEqual(store.calls.update[0].partialData, {
        schedules: [{ startTime: "20:00", endTime: "22:00" }],
        current: { startTime: "23:00", endTime: "01:00" },
    });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);
});

test('"volver" from the first schedule\'s start time uses the engine\'s real BACK, deletes the pending, and returns to FUNCTIONS_WEEKDAYS', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_START_TIME",
        partialData: { schedules: [], current: {} },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(SCHEDULES_STEP_STATE),
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_WEEKDAYS", type: "QUESTION", inputType: "WEEKDAYS", text: "¿Qué días de la semana?" },
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(store.calls.delete.length, 1);
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT);
});

test('if the engine rejects the real BACK from the first schedule, the pending is kept intact', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_START_TIME",
        partialData: { schedules: [], current: {} },
    });
    const { deps } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(SCHEDULES_STEP_STATE),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_RECURRING_SCHEDULES", type: "QUESTION", text: "x", error: "Ya estás en la primera pregunta." } }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.delete.length, 0);
    assert.ok(await store.getPendingStepInput("conv1"));
});

// ==================================================
// GENERAL — cancelar, pending vs step real, persistencia entre webhooks.
// ==================================================

test("cancelling during RANGE/WEEKDAYS/SCHEDULES never touches the pending store — cancelConversation runs first", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_START_TIME",
        partialData: { schedules: [], current: {} },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.equal(store.calls.get.length, 0);
    assert.ok(sendCalls[0].text.includes("Cancelamos"));
});

test("a stale pending belonging to a different step is never reused for RANGE", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "CATEGORY", status: "SOME_OLD_STATUS", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: FROM_TEXT }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], { conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_FROM_DATE", partialData: {} });
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT);
});

test("a stale pending belonging to a different step is never reused for SCHEDULES", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: FROM } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "20:00" }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_START_TIME",
        partialData: { schedules: [], current: {} },
    });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);
});

test("a RANGE pending is never reused if the real current step is no longer FUNCTIONS_RANGE", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "AWAITING_RECURRING_TO_DATE", partialData: { from: FROM } });
    const { deps } = baseDeps({ pendingStore: store, resumeConversation: spy(WEEKDAYS_STEP_STATE) });

    // El texto "30/09/2099" nunca debería interpretarse como fecha "hasta"
    // si el step real ya es WEEKDAYS — cae en el intento de días (inválido,
    // pero nunca toca el pending viejo de RANGE).
    await processInboundMessage(textMessage({ text: TO_TEXT }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test("a SCHEDULES pending is never reused if the real current step has advanced past it", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_RECURRING_ADD_ANOTHER",
        partialData: { schedules: [{ startTime: "20:00", endTime: "22:00" }], current: {} },
    });
    const { deps } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "FREE", label: "Gratis" }] },
        }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    // Nunca se interpreta como "finalizar horarios" — el motor recibe el
    // texto crudo, como cualquier otra respuesta normal.
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "2" }]);
});

test("RANGE survives being split across independent processInboundMessage calls (simulated separate webhooks)", async () => {
    const store = createFakePendingStore();

    const { deps: d1, sendCalls: s1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: FROM_TEXT }), d1);
    assert.equal(s1[0].text, WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT);

    const { deps: d2, sendCalls: s2 } = baseDeps({ pendingStore: store, handleConversationInput: spy(WEEKDAYS_STEP_STATE) });
    await processInboundMessage(textMessage({ text: TO_TEXT }), d2);
    assert.equal(d2.handleConversationInput.calls.length, 1);
    assert.deepEqual(d2.handleConversationInput.calls[0][1], { value: { from: FROM, to: TO } });
    assert.equal(s2[0].text, WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT);
});

test("SCHEDULES survives being split across independent processInboundMessage calls (simulated separate webhooks)", async () => {
    const store = createFakePendingStore();

    const { deps: d1, sendCalls: s1 } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });
    await processInboundMessage(textMessage({ text: "20:00" }), d1);
    assert.equal(s1[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);

    const { deps: d2, sendCalls: s2 } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });
    await processInboundMessage(textMessage({ text: "22:00" }), d2);
    assert.ok(s2[0].text.startsWith("✅ Horario agregado"));
    assert.equal(d2.handleConversationInput.calls.length, 0);

    const generatedSlots = [{ date: "2099-08-20", startTime: "20:00", endTime: "22:00" }];
    const { deps: d3, sendCalls: s3 } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(SCHEDULES_STEP_STATE),
        handleConversationInput: sequentialSpy([
            { conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: generatedSlots } },
            { conversationId: "conv1", prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿El evento es gratuito o pago?" } },
        ]),
    });
    await processInboundMessage(textMessage({ text: "2" }), d3);
    assert.equal(d3.handleConversationInput.calls.length, 2);
    assert.deepEqual(d3.handleConversationInput.calls[1][1], { value: generatedSlots });
    assert.equal(s3[0].text, "¿El evento es gratuito o pago?");
});
