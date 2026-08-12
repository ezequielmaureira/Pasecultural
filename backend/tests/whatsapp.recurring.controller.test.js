import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    extractWhatsappReplyText,
    WHATSAPP_RECURRING_RANGE_PROMPT_TEXT,
    buildWhatsappCompactDateRangeInvalidText,
    WHATSAPP_COMPACT_DATE_RANGE_PAST_TEXT,
    WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT,
    WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT,
    WHATSAPP_RECURRING_WEEKDAYS_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_SCHEDULE_PROMPT_TEXT,
    WHATSAPP_RECURRING_SCHEDULE_NEXT_PROMPT_TEXT,
    WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT,
    WHATSAPP_RECURRING_NO_OCCURRENCES_TEXT,
    buildWhatsappScheduleAddedSummaryText,
    buildWhatsappCompactTimeRangeInvalidText,
    buildWhatsappWeekdaysConfirmationText,
    parseWhatsappWeekdaySelection,
    parseWhatsappCompactDateRangeText,
    isRecurringToBeforeFrom,
    WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3F/3K — árbol de decisión de processInboundMessage para
// FUNCTIONS_MODE = RECURRING: tres steps reales del motor (FUNCTIONS_RANGE,
// FUNCTIONS_WEEKDAYS, FUNCTIONS_RECURRING_SCHEDULES). Fase 3K compacta
// RANGE a un solo mensaje ("01/09 al 30/09", sin pending propio) y cada
// horario de SCHEDULES a un solo mensaje ("20:00-22:00").

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

const RANGE_TEXT = "20/08 al 30/09";
const FROM = "2026-08-20";
const TO = "2026-09-30";
const NOW = new Date("2026-08-12T15:00:00.000Z");

// ==================================================
// extractWhatsappReplyText — los inputTypes de RECURRING nunca muestran el
// texto genérico pensado para la Web.
// ==================================================

test("extractWhatsappReplyText shows the RECURRING-specific compact prompts for DATE_RANGE/WEEKDAYS/TIME_RANGE_LIST", () => {
    assert.equal(
        extractWhatsappReplyText({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_RANGE", type: "QUESTION", inputType: "DATE_RANGE", text: "¿Desde y hasta qué fecha se repiten las funciones?" },
        }),
        WHATSAPP_RECURRING_RANGE_PROMPT_TEXT
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
        WHATSAPP_RECURRING_SCHEDULE_PROMPT_TEXT
    );
});

// ==================================================
// RANGE — Fase 3K: un solo mensaje compacto, sin pending propio.
// ==================================================

test("parseWhatsappCompactDateRangeText parses 'DD/MM al DD/MM' and variants", () => {
    assert.deepEqual(parseWhatsappCompactDateRangeText(RANGE_TEXT, NOW), { from: FROM, to: TO });
    assert.deepEqual(parseWhatsappCompactDateRangeText("20/08-30/09", NOW), { from: FROM, to: TO });
    assert.deepEqual(parseWhatsappCompactDateRangeText("20/08 hasta 30/09", NOW), { from: FROM, to: TO });
});

test("a valid compact range calls the engine exactly once with {from,to}, no pending is created", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store, handleConversationInput: spy(WEEKDAYS_STEP_STATE) });

    await processInboundMessage(textMessage({ text: RANGE_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: { from: FROM, to: TO } }]);
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT);
    assert.equal(store.calls.reset.length, 0);
    assert.equal(store.calls.update.length, 0);
});

test("a malformed compact range never calls the engine, explains the format", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "no sé las fechas" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, buildWhatsappCompactDateRangeInvalidText());
});

test("a from-date before today (Argentina) is rejected as already past, never calling the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "01/01/2000 al 30/09/2000" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_COMPACT_DATE_RANGE_PAST_TEXT);
});

test("a to-date earlier than the from-date is rejected without ever calling the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "30/09 al 20/08" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT);
});

test("isRecurringToBeforeFrom is a pure comparator reused by the subflow", () => {
    assert.equal(isRecurringToBeforeFrom("2099-08-20", "2099-08-10"), true);
    assert.equal(isRecurringToBeforeFrom("2099-08-20", "2099-08-20"), false);
    assert.equal(isRecurringToBeforeFrom("2099-08-20", "2099-09-30"), false);
});

test("a to-date equal to from-date is accepted (same-day range)", async () => {
    const { deps } = baseDeps({ handleConversationInput: spy(WEEKDAYS_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "20/08 al 20/08" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0][1], { value: { from: FROM, to: FROM } });
});

test("if the engine rejects the {from,to}, a clear recoverable message is shown, never loses data silently", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "FUNCTIONS_RANGE", type: "QUESTION", inputType: "DATE_RANGE", text: "x", error: "algo inesperado" } }),
    });

    await processInboundMessage(textMessage({ text: RANGE_TEXT }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT);
});

test('"volver" on FUNCTIONS_RANGE (single sub-step) uses the engine\'s real BACK, returning to FUNCTIONS_MODE', async () => {
    const { deps, sendCalls } = baseDeps({
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
    assert.ok(sendCalls[0].text.includes("¿Este evento ocurre una sola vez o se repite?"));
});

// ==================================================
// WEEKDAYS — parser puro (nombres + índice legado)
// ==================================================

test("parseWhatsappWeekdaySelection accepts day names, with or without accents, comma or 'y'", () => {
    assert.deepEqual(parseWhatsappWeekdaySelection("viernes"), [4]);
    assert.deepEqual(parseWhatsappWeekdaySelection("viernes, sábado"), [4, 5]);
    assert.deepEqual(parseWhatsappWeekdaySelection("viernes y sabado"), [4, 5]);
});

test("parseWhatsappWeekdaySelection still accepts the legacy numeric index (1=Monday..7=Sunday)", () => {
    assert.deepEqual(parseWhatsappWeekdaySelection("1"), [0]);
    assert.deepEqual(parseWhatsappWeekdaySelection("1,3,5"), [0, 2, 4]);
    assert.deepEqual(parseWhatsappWeekdaySelection("1, 3, 5"), [0, 2, 4]);
});

test("parseWhatsappWeekdaySelection dedupes, preserving the order of first appearance", () => {
    assert.deepEqual(parseWhatsappWeekdaySelection("1,1,3"), [0, 2]);
    assert.deepEqual(parseWhatsappWeekdaySelection("viernes, viernes, sábado"), [4, 5]);
});

for (const invalid of ["0", "8", "1,8", "hola", "1.3.5", "", "  "]) {
    test(`parseWhatsappWeekdaySelection rejects "${invalid}"`, () => {
        assert.equal(parseWhatsappWeekdaySelection(invalid), null);
    });
}

test("parseWhatsappWeekdaySelection tolerates an empty token between separators (e.g. a double comma), it never turns that into an error", () => {
    assert.deepEqual(parseWhatsappWeekdaySelection("1,,3"), [0, 2]);
});

test("buildWhatsappWeekdaysConfirmationText lists days in weekly order regardless of input order", () => {
    assert.equal(buildWhatsappWeekdaysConfirmationText([4, 0, 2]), "✅ Días seleccionados:\nLunes, Miércoles y Viernes");
    assert.equal(buildWhatsappWeekdaysConfirmationText([6]), "✅ Días seleccionados:\nDomingo");
});

// ==================================================
// WEEKDAYS — subflujo
// ==================================================

for (const invalid of ["0", "8", "1,8", "hola"]) {
    test(`an invalid weekday selection ("${invalid}") never calls the engine`, async () => {
        const { deps, sendCalls } = baseDeps({ resumeConversation: spy(WEEKDAYS_STEP_STATE) });

        await processInboundMessage(textMessage({ text: invalid }), deps);

        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT);
    });
}

test('a valid numeric selection calls the engine exactly once with the mapped internal array (1=Monday -> 0), and shows the confirmation + next prompt', async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy(WEEKDAYS_STEP_STATE),
        handleConversationInput: spy(SCHEDULES_STEP_STATE),
    });

    await processInboundMessage(textMessage({ text: "1,3,5" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: [0, 2, 4] }]);
    assert.ok(sendCalls[0].text.includes("✅ Días seleccionados"));
    assert.ok(sendCalls[0].text.includes("Lunes, Miércoles y Viernes"));
    assert.equal(sendCalls[0].text, `${buildWhatsappWeekdaysConfirmationText([0, 2, 4])}\n\n${WHATSAPP_RECURRING_SCHEDULE_PROMPT_TEXT}`);
});

test("a valid day-name selection ('viernes, sábado') calls the engine with the same mapped array as the numeric equivalent", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy(WEEKDAYS_STEP_STATE),
        handleConversationInput: spy(SCHEDULES_STEP_STATE),
    });

    await processInboundMessage(textMessage({ text: "viernes, sábado" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: [4, 5] }]);
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
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_RANGE_PROMPT_TEXT);
    assert.equal(store.calls.reset.length, 0);
    assert.equal(store.calls.update.length, 0);
    assert.equal(store.calls.delete.length, 0);
});

test("a text message while the engine is not on FUNCTIONS_WEEKDAYS is never intercepted by this sub-flow", async () => {
    const { deps } = baseDeps({ resumeConversation: spy(RANGE_STEP_STATE), handleConversationInput: spy(WEEKDAYS_STEP_STATE) });

    // "1,3,5" nunca debería llegar a interpretarse como selección de días
    // si el step real es RANGE — cae en el intento de rango compacto
    // (inválido como fecha, pero nunca toca WEEKDAYS).
    await processInboundMessage(textMessage({ text: "1,3,5" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// ==================================================
// SCHEDULES — Fase 3K: un horario por mensaje ("20:00-22:00").
// ==================================================

test("first message on FUNCTIONS_RECURRING_SCHEDULES with no pending initializes AWAITING_TIME_RANGE and accumulates the first schedule", async () => {
    const { deps, sendCalls, store } = baseDeps({ resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "20:00-22:00" }), deps);

    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_TIME_RANGE",
        partialData: { schedules: [] },
    });
    assert.equal(store.calls.update[0].status, "AWAITING_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, { schedules: [{ startTime: "20:00", endTime: "22:00" }] });
    assert.equal(sendCalls[0].text, buildWhatsappScheduleAddedSummaryText({ startTime: "20:00", endTime: "22:00" }));
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor NO se llama tras el primer horario individual");
});

for (const invalidTime of ["8", "25:00-26:00", "hola"]) {
    test(`an invalid compact time range ("${invalidTime}") never advances the schedules sub-flow`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_RECURRING_SCHEDULES",
            status: "AWAITING_TIME_RANGE",
            partialData: { schedules: [] },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

        await processInboundMessage(textMessage({ text: invalidTime }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(sendCalls[0].text, buildWhatsappCompactTimeRangeInvalidText());
    });
}

// ==================================================
// SCHEDULES — agregar otro / finalizar
// ==================================================

test('"1" (add another) starts a second schedule with the "siguiente horario" prompt', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_ADD_ANOTHER",
        partialData: { schedules: [{ startTime: "20:00", endTime: "22:00" }] },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_TIME_RANGE");
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_SCHEDULE_NEXT_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test("completing a second schedule accumulates it after the first one, preserving order", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_TIME_RANGE",
        partialData: { schedules: [{ startTime: "20:00", endTime: "22:00" }] },
    });
    const { deps } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "23:00-01:00" }), deps);

    assert.deepEqual(store.calls.update[0].partialData, {
        schedules: [
            { startTime: "20:00", endTime: "22:00" },
            { startTime: "23:00", endTime: "01:00" },
        ],
    });
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor NO se llama mientras se construye el segundo horario");
});

test('an invalid reply while AWAITING_ADD_ANOTHER never advances and never modifies schedules', async () => {
    const accumulated = [{ startTime: "20:00", endTime: "22:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_ADD_ANOTHER",
        partialData: { schedules: accumulated },
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
        status: "AWAITING_ADD_ANOTHER",
        partialData: { schedules: twoSchedules },
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
        status: "AWAITING_ADD_ANOTHER",
        partialData: { schedules: accumulated },
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
        status: "AWAITING_ADD_ANOTHER",
        partialData: { schedules: accumulated },
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

test('"volver" from AWAITING_TIME_RANGE with confirmed schedules returns to the add-another decision', async () => {
    const accumulated = [{ startTime: "20:00", endTime: "22:00" }];
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_TIME_RANGE",
        partialData: { schedules: accumulated },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_ADD_ANOTHER");
    assert.deepEqual(store.calls.update[0].partialData, { schedules: accumulated });
    assert.equal(sendCalls[0].text, buildWhatsappScheduleAddedSummaryText(accumulated[0]));
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test('"volver" from AWAITING_ADD_ANOTHER discards the last schedule and re-asks it from scratch', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_ADD_ANOTHER",
        partialData: {
            schedules: [
                { startTime: "20:00", endTime: "22:00" },
                { startTime: "23:00", endTime: "01:00" },
            ],
        },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_TIME_RANGE");
    assert.deepEqual(store.calls.update[0].partialData, { schedules: [{ startTime: "20:00", endTime: "22:00" }] });
    assert.equal(sendCalls[0].text, WHATSAPP_RECURRING_SCHEDULE_NEXT_PROMPT_TEXT);
});

test('"volver" from the first schedule\'s time range uses the engine\'s real BACK, deletes the pending, and returns to FUNCTIONS_WEEKDAYS', async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_TIME_RANGE",
        partialData: { schedules: [] },
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
        status: "AWAITING_TIME_RANGE",
        partialData: { schedules: [] },
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

test("cancelling during SCHEDULES never touches the pending store — cancelConversation runs first", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_TIME_RANGE",
        partialData: { schedules: [] },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.equal(store.calls.get.length, 0);
    assert.ok(sendCalls[0].text.includes("Cancelamos"));
});

test("a stale pending belonging to a different step is never reused for SCHEDULES", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_RANGE", status: "SOME_OLD_STATUS", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });

    await processInboundMessage(textMessage({ text: "20:00-22:00" }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_TIME_RANGE",
        partialData: { schedules: [] },
    });
    assert.equal(sendCalls[0].text, buildWhatsappScheduleAddedSummaryText({ startTime: "20:00", endTime: "22:00" }));
});

test("a SCHEDULES pending is never reused if the real current step has advanced past it", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_RECURRING_SCHEDULES",
        status: "AWAITING_ADD_ANOTHER",
        partialData: { schedules: [{ startTime: "20:00", endTime: "22:00" }] },
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

test("SCHEDULES survives being split across independent processInboundMessage calls (simulated separate webhooks)", async () => {
    const store = createFakePendingStore();

    const { deps: d1, sendCalls: s1 } = baseDeps({ pendingStore: store, resumeConversation: spy(SCHEDULES_STEP_STATE) });
    await processInboundMessage(textMessage({ text: "20:00-22:00" }), d1);
    assert.ok(s1[0].text.startsWith("✅ Horario agregado"));
    assert.equal(d1.handleConversationInput.calls.length, 0);

    const generatedSlots = [{ date: "2099-08-20", startTime: "20:00", endTime: "22:00" }];
    const { deps: d2, sendCalls: s2 } = baseDeps({
        pendingStore: store,
        resumeConversation: spy(SCHEDULES_STEP_STATE),
        handleConversationInput: sequentialSpy([
            { conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: generatedSlots } },
            { conversationId: "conv1", prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿El evento es gratuito o pago?" } },
        ]),
    });
    await processInboundMessage(textMessage({ text: "2" }), d2);
    assert.equal(d2.handleConversationInput.calls.length, 2);
    assert.deepEqual(d2.handleConversationInput.calls[1][1], { value: generatedSlots });
    assert.equal(s2[0].text, "¿El evento es gratuito o pago?");
});
