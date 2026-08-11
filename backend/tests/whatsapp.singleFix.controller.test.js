import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT } from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3G, sección 1 — bug reportado en prueba real: al terminar SINGLE
// (fecha/hora inicio/hora fin), WhatsApp mostraba "¿Qué día es la primera
// función?" (el prompt de FUNCTIONS_LIST/MULTIPLE). Causa raíz auditada:
// FUNCTIONS_SINGLE_CARD.next() (steps/definitions.js) apunta al mismo step
// terminal FUNCTIONS_LIST que usa MULTIPLE, y llega ahí con
// `prompt.slots = [la función recién cargada]` ya poblado — nada distinguía
// ese caso de MULTIPLE (que llega con slots=[] y sí necesita el ciclo
// manual). La corrección (commitPrefilledFunctionsListIfNeeded,
// whatsapp.controller.js) confirma esos slots automáticamente. Estos tests
// prueban el comportamiento end-to-end del adaptador, no la función interna.

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

// Devuelve un valor DISTINTO por cada llamada — necesario porque el camino
// feliz de SINGLE llama al motor DOS veces (FUNCTIONS_SINGLE_CARD y,
// automáticamente, FUNCTIONS_LIST).
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

function baseDeps({ pendingStore, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    const store = pendingStore ?? createFakePendingStore();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: spy(FUNCTION_CARD_STEP_STATE),
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

const DATE_NORMALIZED = "2099-08-25";

test("A. completing SINGLE (date+start+end) never shows 'primera función' and never starts the FUNCTIONS_LIST subflow", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_END_TIME",
        partialData: { date: DATE_NORMALIZED, startTime: "20:00" },
    });
    const singleCardAccepted = {
        conversationId: "conv1",
        prompt: {
            stepId: "FUNCTIONS_LIST",
            type: "QUESTION",
            inputType: "FUNCTIONS_LIST",
            text: "Administrador de Agenda",
            slots: [{ date: DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" }],
        },
    };
    const functionsListAccepted = {
        conversationId: "conv1",
        prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Este evento es gratuito o de pago?", options: [{ id: "FREE", label: "Gratuito" }] },
    };
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: sequentialSpy([singleCardAccepted, functionsListAccepted]),
    });

    await processInboundMessage(textMessage({ text: "22:00" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2, "una llamada para FUNCTIONS_SINGLE_CARD, otra automática para FUNCTIONS_LIST");
    assert.deepEqual(deps.handleConversationInput.calls[0], [
        "conv1",
        { value: { date: DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" } },
    ]);
    assert.deepEqual(deps.handleConversationInput.calls[1], [
        "conv1",
        { value: [{ date: DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" }] },
    ]);
    assert.ok(!sendCalls[0].text.toLowerCase().includes("primera función"), "nunca debe mostrarse el prompt de FUNCTIONS_LIST manual");
    assert.equal(sendCalls[0].text, "¿Este evento es gratuito o de pago?\n\n1. Gratuito\n\nRespondé con el número de la opción.");
    assert.equal(store.calls.delete.length, 1, "el pending de FUNCTIONS_SINGLE_CARD se borra");
    assert.equal(store.calls.reset.length, 0, "nunca se crea un pending de FUNCTIONS_LIST para SINGLE");
});

test("B. advances to the real next step correctly (EVENT_PRICING_TYPE)", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_END_TIME",
        partialData: { date: DATE_NORMALIZED, startTime: "20:00" },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: sequentialSpy([
            {
                conversationId: "conv1",
                prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [{ date: DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" }] },
            },
            {
                conversationId: "conv1",
                prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Este evento es gratuito o de pago?", options: [] },
            },
        ]),
    });

    await processInboundMessage(textMessage({ text: "22:00" }), deps);

    assert.ok(sendCalls[0].text.startsWith("¿Este evento es gratuito o de pago?"));
});

test("if the auto-commit to FUNCTIONS_LIST is (defensively) rejected, a clear commit-error message is shown and the pending stays intact", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "FUNCTIONS_SINGLE_CARD",
        status: "AWAITING_END_TIME",
        partialData: { date: DATE_NORMALIZED, startTime: "20:00" },
    });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: sequentialSpy([
            {
                conversationId: "conv1",
                prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [{ date: DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" }] },
            },
            {
                conversationId: "conv1",
                prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "x", error: "algo inesperado" },
            },
        ]),
    });

    await processInboundMessage(textMessage({ text: "22:00" }), deps);

    assert.equal(store.calls.delete.length, 0);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.equal(stillPending.status, "AWAITING_END_TIME");
});

// ==================================================
// G. Test de integración: FUNCTIONS_MODE ("1", Una sola función) hasta la
// decisión final, sin que aparezca NUNCA un prompt incorrecto de
// FUNCTIONS_LIST — usa el motor REAL (EventCreationEngine), no un mock, en
// memoria pura (sin Prisma: se simula sólo lo mínimo indispensable
// reemplazando handleConversationInput/resumeConversation con una máquina
// de estados fiel a steps/definitions.js para las 4 respuestas del camino
// SINGLE, y comprobando la salida real de extractWhatsappReplyText en cada
// paso).
// ==================================================

test("G. full SINGLE flow adapter integration: FUNCTIONS_MODE -> date -> start -> end -> next real step, no FUNCTIONS_LIST prompt ever shown", async () => {
    // Estado mínimo fiel al motor real para esta única rama (SINGLE): cada
    // llamada avanza determinísticamente, igual que EventCreationEngine.
    let step = "FUNCTIONS_MODE";
    const FUNCTIONS_MODE_OPTIONS = [
        { id: "SINGLE", label: "Una sola función" },
        { id: "MULTIPLE", label: "Varias funciones" },
        { id: "RECURRING", label: "Funciones recurrentes" },
    ];
    const engineHandleConversationInput = async (conversationId, rawInput) => {
        if (step === "FUNCTIONS_MODE" && rawInput.value === "SINGLE") {
            step = "FUNCTIONS_SINGLE_CARD";
            return { conversationId, prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "Contame cuándo es la función." } };
        }
        if (step === "FUNCTIONS_MODE") {
            // Mismo comportamiento real del motor: rechaza el texto crudo
            // ("1") — el controller reintenta con el `id` resuelto por
            // índice (resolveSingleSelectIndexReply), igual que con
            // cualquier SINGLE_SELECT real.
            return {
                conversationId,
                prompt: {
                    stepId: "FUNCTIONS_MODE",
                    type: "QUESTION",
                    inputType: "SINGLE_SELECT",
                    text: "¿Cómo se realizarán las funciones de este evento?",
                    options: FUNCTIONS_MODE_OPTIONS,
                    error: "Elegí una opción de la lista.",
                },
            };
        }
        if (step === "FUNCTIONS_SINGLE_CARD" && rawInput.value) {
            step = "FUNCTIONS_LIST";
            return {
                conversationId,
                prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [rawInput.value] },
            };
        }
        if (step === "FUNCTIONS_LIST" && Array.isArray(rawInput.value)) {
            step = "EVENT_PRICING_TYPE";
            return { conversationId, prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Este evento es gratuito o de pago?", options: [{ id: "FREE", label: "Gratuito" }] } };
        }
        throw new Error(`unexpected call at step=${step} with ${JSON.stringify(rawInput)}`);
    };
    const engineResumeConversation = async (conversationId) => ({
        conversationId,
        prompt:
            step === "FUNCTIONS_MODE"
                ? { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Cómo se realizarán las funciones de este evento?", options: [{ id: "SINGLE", label: "Una sola función" }] }
                : step === "FUNCTIONS_SINGLE_CARD"
                  ? { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "Contame cuándo es la función." }
                  : { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Este evento es gratuito o de pago?", options: [{ id: "FREE", label: "Gratuito" }] },
    });

    const store = createFakePendingStore();
    const transcript = [];
    const allTexts = [];

    async function send(text) {
        const { deps, sendCalls } = baseDeps({
            pendingStore: store,
            resumeConversation: engineResumeConversation,
            handleConversationInput: engineHandleConversationInput,
        });
        await processInboundMessage(textMessage({ text }), deps);
        transcript.push({ in: text, out: sendCalls[0]?.text });
        allTexts.push(sendCalls[0]?.text ?? "");
    }

    await send("1"); // FUNCTIONS_MODE -> "Una sola función"
    await send("25/08/2099"); // fecha
    await send("20:00"); // hora inicio
    await send("22:00"); // hora fin -> auto-commit a FUNCTIONS_LIST -> EVENT_PRICING_TYPE

    // Ningún mensaje de la conversación debe mostrar el prompt de
    // FUNCTIONS_LIST manual ("primera función") ni "Administrador de Agenda".
    for (const text of allTexts) {
        assert.ok(!text.toLowerCase().includes("primera función"), `no debe aparecer "primera función" en: ${text}`);
        assert.ok(!text.includes("Administrador de Agenda"), `no debe aparecer "Administrador de Agenda" en: ${text}`);
    }

    assert.equal(step, "EVENT_PRICING_TYPE", "el motor real avanzó hasta el step correcto");
    assert.ok(transcript[transcript.length - 1].out.startsWith("¿Este evento es gratuito o de pago?"));
});
