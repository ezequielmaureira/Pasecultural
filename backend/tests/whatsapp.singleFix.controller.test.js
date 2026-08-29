import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT } from "../src/services/whatsappOrganizerBot.service.js";

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
//
// Fase 3K — FUNCTIONS_SINGLE_CARD dejó de necesitar WhatsappPendingStepInput
// (un solo mensaje compacto "25/08/2099, 20:00-22:00" reemplaza las 3
// preguntas separadas de antes) — el bug original y su regresión siguen
// siendo válidos, pero ya no hay ningún pending que sobreviva entre
// mensajes para este step.

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

function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }),
            resumeConversation: spy(FUNCTION_CARD_STEP_STATE),
            cancelConversation: spy(undefined),
            // Premium — Fase 2C. Este archivo no prueba el feature gate —
            // por default PREMIUM preserva el comportamiento histórico.
            getOrganizationPlanForWhatsapp: spy({ plan: "PREMIUM" }),
            getPendingStepInput: spy(null),
            resetPendingStepInput: spy(undefined),
            updatePendingStepInputStatus: spy(undefined),
            deletePendingStepInput: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

const DATE_NORMALIZED = "2099-08-25";
const COMPACT_TEXT = "25/08/2099, 20:00-22:00";
const SLOT = { date: DATE_NORMALIZED, startTime: "20:00", endTime: "22:00" };

test("A. completing SINGLE (one compact message) never shows 'primera función' and never starts the FUNCTIONS_LIST manual subflow", async () => {
    const singleCardAccepted = {
        conversationId: "conv1",
        prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [SLOT] },
    };
    const functionsListAccepted = {
        conversationId: "conv1",
        prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "x", options: [{ id: "FREE", label: "Gratuito" }] },
    };
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([singleCardAccepted, functionsListAccepted]),
    });

    await processInboundMessage(textMessage({ text: COMPACT_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2, "una llamada para FUNCTIONS_SINGLE_CARD, otra automática para FUNCTIONS_LIST");
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: SLOT }]);
    assert.deepEqual(deps.handleConversationInput.calls[1], ["conv1", { value: [SLOT] }]);
    assert.ok(!sendCalls[0].text.toLowerCase().includes("primera función"), "nunca debe mostrarse el prompt de FUNCTIONS_LIST manual");
    assert.ok(!sendCalls[0].text.includes("Administrador de Agenda"));
    assert.equal(sendCalls[0].text, "¿El evento es gratuito o pago?\n\n1. Gratuito\n\nRespondé con el número de la opción.");
});

test("B. advances to the real next step correctly (EVENT_PRICING_TYPE)", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([
            { conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [SLOT] } },
            { conversationId: "conv1", prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "x", options: [] } },
        ]),
    });

    await processInboundMessage(textMessage({ text: COMPACT_TEXT }), deps);

    assert.ok(sendCalls[0].text.startsWith("¿El evento es gratuito o pago?"));
});

test("if the auto-commit to FUNCTIONS_LIST is (defensively) rejected, a clear commit-error message is shown", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([
            { conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "Administrador de Agenda", slots: [SLOT] } },
            { conversationId: "conv1", prompt: { stepId: "FUNCTIONS_LIST", type: "QUESTION", inputType: "FUNCTIONS_LIST", text: "x", error: "algo inesperado" } },
        ]),
    });

    await processInboundMessage(textMessage({ text: COMPACT_TEXT }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.equal(sendCalls[0].text, WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT);
});

// ==================================================
// G. Test de integración: FUNCTIONS_MODE ("1", Una sola función) hasta la
// decisión final, sin que aparezca NUNCA un prompt incorrecto de
// FUNCTIONS_LIST — usa una máquina de estados fiel a steps/definitions.js
// (no Prisma) para las 2 respuestas del camino SINGLE compacto: "1" y
// "25/08/2099, 20:00-22:00".
// ==================================================

test("G. full SINGLE flow adapter integration: FUNCTIONS_MODE -> compact date+time -> next real step, no FUNCTIONS_LIST prompt ever shown", async () => {
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
            return { conversationId, prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "x", options: [{ id: "FREE", label: "Gratuito" }] } };
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
                  : { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "x", options: [{ id: "FREE", label: "Gratuito" }] },
    });

    const transcript = [];
    const allTexts = [];

    async function send(text) {
        const { deps, sendCalls } = baseDeps({
            resumeConversation: engineResumeConversation,
            handleConversationInput: engineHandleConversationInput,
        });
        await processInboundMessage(textMessage({ text }), deps);
        transcript.push({ in: text, out: sendCalls[0]?.text });
        allTexts.push(sendCalls[0]?.text ?? "");
    }

    await send("1"); // FUNCTIONS_MODE -> "Una sola función"
    await send(COMPACT_TEXT); // fecha+horario compacto -> auto-commit a FUNCTIONS_LIST -> EVENT_PRICING_TYPE

    for (const text of allTexts) {
        assert.ok(!text.toLowerCase().includes("primera función"), `no debe aparecer "primera función" en: ${text}`);
        assert.ok(!text.includes("Administrador de Agenda"), `no debe aparecer "Administrador de Agenda" en: ${text}`);
    }

    assert.equal(step, "EVENT_PRICING_TYPE", "el motor real avanzó hasta el step correcto");
    assert.ok(transcript[transcript.length - 1].out.startsWith("¿El evento es gratuito o pago?"));
});
