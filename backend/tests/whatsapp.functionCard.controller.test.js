import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_FUNCTION_CARD_DATE_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT,
    WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT,
    WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT,
    WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT,
    WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT,
    WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3C — árbol de decisión de processInboundMessage para el sub-flujo
// conversacional de FUNCTIONS_SINGLE_CARD (fecha -> hora inicio -> hora
// fin). Reemplaza tests/whatsappFunctionCard.parser.test.js (eliminado
// junto con parseWhatsappFunctionCardText, que ya no existe) y reescribe
// por completo este archivo: el formato compuesto de un solo mensaje
// ("DD/MM/AAAA HH:MM a HH:MM") deja de ser la UX aceptada.
//
// El estado temporal (WhatsappPendingStepInput) se simula con un store en
// memoria del propio test — no es un mock del motor ni de Prisma, es
// exactamente el mismo contrato del service real (whatsappPendingStepInput.service.js),
// así que estos tests ejercitan la orquestación completa (incluida la
// persistencia entre "mensajes"/llamadas separadas a processInboundMessage,
// que es justamente lo que hace falta probar para "sobrevive un reinicio
// entre webhooks": cada llamada a processInboundMessage es independiente,
// el único hilo compartido entre una y otra es este store, igual que en
// producción sería una fila real de Postgres).

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

const FUNCTION_CARD_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "Contame cuándo es la función." },
    canGoBack: true,
    sections: [],
};

const NEXT_STEP_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [] },
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
            resumeConversation: spy(FUNCTION_CARD_STEP_STATE),
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

// Fecha usada en los tests: siempre muy en el futuro respecto a la fecha
// real del sistema en cualquier momento en que corran (evita que el test
// dependa de la fecha de hoy).
const FUTURE_DATE_TEXT = "25/08/2099";
const FUTURE_DATE_NORMALIZED = "2099-08-25";

// ==================================================
// 0) Validación final previa al commit — el mensaje que el motor acaba de
// avanzar A FUNCTIONS_SINGLE_CARD (ej. justo después de responder "1" a
// FUNCTIONS_MODE, "Una sola función") debe mostrar el prompt NUEVO de
// fecha sola — nunca el formato compuesto viejo
// ("DD/MM/AAAA HH:MM a HH:MM"), que ya no existe en el código. Este
// mensaje en particular NO pasa por tryHandleFunctionCardSubflow (el step
// todavía es FUNCTIONS_MODE en el momento en que se recibe "1"): el motor
// avanza solo y extractWhatsappReplyText es quien decide qué mostrar.
// ==================================================

test("landing on FUNCTIONS_SINGLE_CARD for the first time shows the new date-only prompt, never the old compound format", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        // Todavía en FUNCTIONS_MODE en el instante en que llega "1" — el
        // motor recién va a avanzar A FUNCTIONS_SINGLE_CARD como resultado
        // de esta respuesta, no antes.
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", options: [{ id: "SINGLE", label: "Una sola función" }] },
            canGoBack: true,
            sections: [],
        }),
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "Contame cuándo es la función." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_PROMPT_TEXT);
    assert.equal(sendCalls[0].text, "📅 ¿Qué día es la función?\n\nEscribí la fecha así:\nDD/MM/AAAA\n\nEjemplo:\n25/08/2026");
    assert.ok(sendCalls[0].text.includes("DD/MM/AAAA"));
    assert.ok(!sendCalls[0].text.includes("HH:MM a HH:MM"), "el formato compuesto viejo no debe aparecer nunca más");
    // Todavía no se creó ningún pending: recién se ACABA de mostrar la
    // pregunta de fecha, el sub-flujo arranca con la PRÓXIMA respuesta.
    assert.equal(store.calls.reset.length, 0);
});

// ==================================================
// 1) primer ingreso: no hay pending, el step real es FUNCTIONS_SINGLE_CARD
// ==================================================

test("first message on FUNCTIONS_SINGLE_CARD with no pending initializes AWAITING_DATE and treats the message as the date answer", async () => {
    const { deps, sendCalls, store } = baseDeps();

    await processInboundMessage(textMessage({ text: FUTURE_DATE_TEXT }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_DATE",
        partialData: {},
    });
    // La fecha válida ya hace avanzar a AWAITING_START_TIME en la MISMA llamada.
    assert.equal(store.calls.update.length, 1);
    assert.equal(store.calls.update[0].status, "AWAITING_START_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { date: FUTURE_DATE_NORMALIZED });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// 2/3) fecha válida -> AWAITING_START_TIME, normalizada correctamente
test("a valid date advances to AWAITING_START_TIME with the date normalized to YYYY-MM-DD", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status: "AWAITING_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "01/12/2099" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_START_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { date: "2099-12-01" });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
});

// 4/5) fecha inválida / inexistente -> no avanza
for (const invalidDate of ["31/02/2099", "32/08/2099", "00/08/2099", "no sé", "25/8/2099"]) {
    test(`an invalid date ("${invalidDate}") never advances the sub-flow`, async () => {
        const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status: "AWAITING_DATE", partialData: {} });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidDate }), deps);

        assert.equal(store.calls.update.length, 0, "no debe actualizar el pending ante una fecha inválida");
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT);
    });
}

// 6) fecha anterior a hoy -> no avanza
test("a date before today (Argentina) is rejected as already past, never advances", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status: "AWAITING_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "01/01/2000" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT);
});

// 7/8) fecha igual a hoy / futura -> válidas
test("today's date (Argentina) is accepted as valid", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status: "AWAITING_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    const now = new Date();
    const todayDDMMYYYY = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${now.getUTCFullYear()}`;

    await processInboundMessage(textMessage({ text: todayDDMMYYYY }), deps);

    // No aserta el status exacto (podría rechazarse si el reloj real cae
    // justo del otro lado del límite ART/UTC en el instante del test) —
    // el límite exacto ya está cubierto por whatsappFunctionCardDate.test.js.
    // Alcanza con confirmar que no quedó en el mensaje genérico de "fecha
    // inválida" (formato sí reconocido).
    assert.notEqual(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT);
});

test("a future date is accepted as valid", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status: "AWAITING_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: FUTURE_DATE_TEXT }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
});

// 9) hora inicio válida -> AWAITING_END_TIME
test("a valid start time advances to AWAITING_END_TIME, keeping the date already confirmed", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_START_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "20:00" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_END_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// 10) hora inicio inválida -> no avanza
for (const invalidTime of ["8:00", "25:00", "20.30", "hola"]) {
    test(`an invalid start time ("${invalidTime}") never advances the sub-flow`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_SINGLE_CARD",
            status: "AWAITING_START_TIME",
            partialData: { date: FUTURE_DATE_NORMALIZED },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidTime }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT);
    });
}

// 11) hora fin inválida -> no avanza (incluye "manda una fecha" ahí, sección 14)
for (const invalidEndTime of ["25:00", "21.00", "hola", FUTURE_DATE_TEXT]) {
    test(`an invalid end time ("${invalidEndTime}", including a date sent by mistake) never advances the sub-flow`, async () => {
        const store = createFakePendingStore({
            conversationId: "conv1",
            stepId: "FUNCTIONS_SINGLE_CARD",
            status: "AWAITING_END_TIME",
            partialData: { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" },
        });
        const { deps, sendCalls } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: invalidEndTime }), deps);

        assert.equal(store.calls.update.length, 0);
        assert.equal(store.calls.delete.length, 0);
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT);

        // La fecha y la hora de inicio ya confirmadas nunca se pierden.
        const stillPending = await store.getPendingStepInput("conv1");
        assert.deepEqual(stillPending.partialData, { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" });
    });
}

// 12/13/14) completar los tres -> objeto correcto, motor llamado EXACTAMENTE una vez
test("completing all three answers calls the engine exactly once with the exact object it expects", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_END_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "23:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], [
        "conv1",
        { value: { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "23:00" } },
    ]);
    // Fase 3E — el motor avanzó a FUNCTIONS_LIST, que ahora también es
    // conversacional: el prompt mostrado es su primera pregunta (fecha de
    // la primera función), nunca el genérico "Administrador de Agenda".
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT);
});

// 15) pending eliminado tras aceptación
test("the pending is deleted after the engine accepts the final object", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_END_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" },
    });
    const { deps } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "23:00" }), deps);

    assert.equal(store.calls.delete.length, 1);
    assert.deepEqual(store.calls.delete[0], "conv1");
    assert.equal(await store.getPendingStepInput("conv1"), null);
});

// 16) error final del motor deja estado recuperable
test("if the engine rejects the final object, the pending is NOT deleted and stays recoverable at AWAITING_END_TIME", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_END_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "x", error: "algo inesperado" },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "23:00" }), deps);

    assert.equal(store.calls.delete.length, 0, "nunca se borra el pending ante un rechazo del motor");
    const stillPending = await store.getPendingStepInput("conv1");
    assert.equal(stillPending.status, "AWAITING_END_TIME");
    assert.deepEqual(stillPending.partialData, { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT);
});

// 17) pending viejo de otro step no se reutiliza
test("a stale pending belonging to a different step is never reused — it gets reset for FUNCTIONS_SINGLE_CARD", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "LOCATION",
        status: "AWAITING_STREET",
        partialData: { street: "Colón" },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: FUTURE_DATE_TEXT }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], {
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_DATE",
        partialData: {},
    });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
});

// 18) cancelar — el chequeo de cancelación ocurre ANTES de tocar el sub-flujo
test("cancelling never touches the FUNCTION_CARD pending store — cancelConversation runs first and short-circuits", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_START_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.equal(store.calls.get.length, 0);
    assert.equal(store.calls.update.length, 0);
    assert.ok(sendCalls[0].text.includes("Cancelamos"));
});

// 19) "reinicio"/webhooks separados: dos llamadas independientes a
// processInboundMessage comparten sólo el store (persistencia), nunca
// estado en memoria del proceso — cada llamada resuelve sus deps desde
// cero, igual que ocurriría entre dos requests HTTP reales tras un reinicio.
test("the sub-flow survives being split across independent processInboundMessage calls (simulated separate webhooks)", async () => {
    const store = createFakePendingStore();

    const { deps: depsMsg1, sendCalls: sendCalls1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: FUTURE_DATE_TEXT }), depsMsg1);
    assert.equal(sendCalls1[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);

    // "Render reinicia" — deps completamente nuevas, mismo store (la única
    // continuidad real sería Postgres en producción).
    const { deps: depsMsg2, sendCalls: sendCalls2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "20:00" }), depsMsg2);
    assert.equal(sendCalls2[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT);
    assert.equal(depsMsg2.handleConversationInput.calls.length, 0);

    const { deps: depsMsg3, sendCalls: sendCalls3 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "23:00" }), depsMsg3);
    assert.equal(depsMsg3.handleConversationInput.calls.length, 1);
    assert.deepEqual(depsMsg3.handleConversationInput.calls[0][1], {
        value: { date: FUTURE_DATE_NORMALIZED, startTime: "20:00", endTime: "23:00" },
    });
    // Fase 3E — mismo motivo que arriba: FUNCTIONS_LIST también es
    // conversacional ahora.
    assert.equal(sendCalls3[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT);
});

// ==================================================
// Validación final previa al commit, sección 3 — secuencia completa exacta,
// con las 4 aserciones pedidas explícitas en un solo test: 0 llamadas al
// motor después de fecha, 0 después de hora de inicio, exactamente 1
// después de hora de fin, y el pending eliminado SÓLO después de esa
// aceptación (nunca antes).
// ==================================================
test("full sequence (fecha -> hora inicio -> hora fin): 0/0/1 llamadas al motor, pending eliminado sólo tras la aceptación final", async () => {
    const store = createFakePendingStore();

    // BOT ya pidió la fecha (ver test de más arriba) — USER responde:
    const { deps: depsDate, sendCalls: sendCallsDate } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "25/08/2099" }), depsDate);
    assert.equal(depsDate.handleConversationInput.calls.length, 0, "después de fecha: 0 llamadas a handleConversationInput");
    assert.equal(sendCallsDate[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT, "BOT pide hora inicio");
    assert.ok(await store.getPendingStepInput("conv1"), "el pending sigue existiendo, todavía no se aceptó nada");

    // USER responde hora de inicio:
    const { deps: depsStart, sendCalls: sendCallsStart } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "20:00" }), depsStart);
    assert.equal(depsStart.handleConversationInput.calls.length, 0, "después de hora inicio: 0 llamadas a handleConversationInput");
    assert.equal(sendCallsStart[0].text, WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT, "BOT pide hora fin");
    assert.ok(await store.getPendingStepInput("conv1"), "el pending sigue existiendo, todavía no se aceptó nada");

    // USER responde hora de fin:
    const { deps: depsEnd, sendCalls: sendCallsEnd } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "23:00" }), depsEnd);
    assert.equal(depsEnd.handleConversationInput.calls.length, 1, "después de hora fin: exactamente 1 llamada a handleConversationInput");
    assert.deepEqual(depsEnd.handleConversationInput.calls[0], [
        "conv1",
        { value: { date: "2099-08-25", startTime: "20:00", endTime: "23:00" } },
    ]);
    // BOT devuelve inmediatamente el prompt del siguiente step real del motor.
    // Fase 3E — mismo motivo que arriba: FUNCTIONS_LIST también es
    // conversacional ahora.
    assert.equal(sendCallsEnd[0].text, WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT);
    // El pending recién ahora, tras la aceptación del motor, desaparece.
    assert.equal(await store.getPendingStepInput("conv1"), null, "el pending se elimina SÓLO después de la aceptación del motor");
});

// 23) el sub-flujo nunca queda "abierto" a un mensaje fuera del step
test("a text message while the engine is not on FUNCTIONS_SINGLE_CARD is never intercepted by this sub-flow", async () => {
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

// ==================================================
// Fase 3D — VOLVER dentro de FUNCTIONS_SINGLE_CARD (sección 8/9 del pedido).
// ==================================================

// 19) hora fin → volver → hora inicio
test("19) AWAITING_END_TIME + 'volver' -> AWAITING_START_TIME, keeps date, removes startTime", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_END_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_START_TIME");
    assert.deepEqual(store.calls.update[0].partialData, { date: FUTURE_DATE_NORMALIZED });
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// 20) hora inicio → volver → fecha
test("20) AWAITING_START_TIME + 'volver' -> AWAITING_DATE, removes date", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_START_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "VOLVER" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_DATE");
    assert.deepEqual(store.calls.update[0].partialData, {});
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_DATE_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// 21) partialData se limpia correctamente en ambos casos (ya verificado
// arriba con deepEqual exacto); test adicional confirmando que "volver"
// nunca toca el motor en ningún sub-paso intermedio.
test("21) 'volver' from any intermediate sub-step never calls the engine", async () => {
    for (const [status, partialData] of [
        ["AWAITING_START_TIME", { date: FUTURE_DATE_NORMALIZED }],
        ["AWAITING_END_TIME", { date: FUTURE_DATE_NORMALIZED, startTime: "20:00" }],
    ]) {
        const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status, partialData });
        const { deps } = baseDeps({ pendingStore: store });

        await processInboundMessage(textMessage({ text: " volver " }), deps);

        assert.equal(deps.handleConversationInput.calls.length, 0, `no debe llamar al motor desde ${status}`);
    }
});

// 22) fecha + volver → comportamiento auditado/documentado: NO es "no
// implementado" — se audité que el motor expone un BACK real y seguro
// (handleInput con {action:"BACK"}, agnóstico al inputType del step
// actual) y se usa acá. currentStepId sigue siendo FUNCTIONS_SINGLE_CARD
// durante todo el sub-flujo (nunca se llamó a handleInput todavía), así
// que retrocede correctamente a FUNCTIONS_MODE.
test("22) AWAITING_DATE (primer sub-paso) + 'volver' uses the engine's real BACK and deletes the pending", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status: "AWAITING_DATE", partialData: {} });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Cómo se realizarán las funciones de este evento?", options: [{ id: "SINGLE", label: "Una sola función" }] },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(store.calls.delete.length, 1);
    assert.ok(sendCalls[0].text.includes("Una sola función"));
});

test("if the engine rejects BACK from AWAITING_DATE (no previous step to go back to), the pending is not deleted", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "FUNCTIONS_SINGLE_CARD", status: "AWAITING_DATE", partialData: {} });
    const { deps } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", text: "x", error: "Ya estás en la primera pregunta." },
            canGoBack: false,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.delete.length, 0);
});

// Cross-subflow: un pending viejo de FUNCTIONS_SINGLE_CARD nunca se
// reutiliza si el step real vigente ya no es FUNCTIONS_SINGLE_CARD (ej. la
// conversación avanzó a LOCATION).
test("a stale FUNCTIONS_SINGLE_CARD pending is never reused when the real current step has moved on to something else", async () => {
    // stepId real = CATEGORY (no LOCATION) a propósito: LOCATION tiene su
    // propio subflow que corre primero en el controller — usar un step sin
    // ningún subflow propio aísla específicamente el chequeo de
    // tryHandleFunctionCardSubflow (ver la contraparte de este mismo test,
    // con LOCATION como step real, en whatsapp.location.controller.test.js).
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_START_TIME",
        partialData: { date: FUTURE_DATE_NORMALIZED },
    });
    const { deps } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", text: "Elegí la categoría de tu evento.", options: [{ id: "MUSICA", label: "Música" }] },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "20:00" }), deps);

    // No se interpretó "20:00" como respuesta a la hora de inicio del
    // sub-flujo FUNCTIONS_SINGLE_CARD — cae al camino normal (SINGLE_SELECT
    // / texto libre), nunca actualiza el pending viejo.
    assert.equal(store.calls.update.length, 0);
});
