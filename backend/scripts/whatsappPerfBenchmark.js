// Fase 3H — benchmark LOCAL y CONTROLADO del overhead interno del adaptador
// WhatsApp, con mocks (sin Postgres/Meta reales). Sirve ÚNICAMENTE para
// comparar el costo arquitectónico de processInboundMessage antes/después de
// la optimización "resumeConversation/getPendingStepInput una sola vez por
// mensaje" — NO representa la latencia real de producción (esa depende de
// la latencia real de Supabase/Render/Meta, que este script no mide).
//
// Se simula un costo artificial por lectura (resumeConversation/
// getPendingStepInput) de MOCK_DB_LATENCY_MS, pensado como una aproximación
// razonable de un round-trip real a Postgres sobre la red (Supabase) — el
// número en sí es arbitrario, lo que importa es la PROPORCIÓN entre
// escenarios, no el valor absoluto.
//
// Uso:
//   node scripts/whatsappPerfBenchmark.js
//
// Este script sólo depende de la interfaz pública de processInboundMessage
// (message, deps) — nunca de sus sub-flujos internos — así que sirve tal
// cual para medir CUALQUIER versión del controller (se usó exactamente este
// mismo archivo, sin cambios, contra el código pre-Fase 3H vía `git stash`
// y contra el código post-Fase 3H, ver informe de entrega).

import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";

const MOCK_DB_LATENCY_MS = 15;
const RUNS_PER_SCENARIO = 30;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.BENCH",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "hola",
        image: null,
        location: null,
        profileName: "Bench",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

function spyInstant(returnValue) {
    return async (...args) => (typeof returnValue === "function" ? returnValue(...args) : returnValue);
}

function spyWithDbLatency(returnValue) {
    return async (...args) => {
        await delay(MOCK_DB_LATENCY_MS);
        return typeof returnValue === "function" ? returnValue(...args) : returnValue;
    };
}

function stepState(stepId, inputType, extra = {}) {
    return {
        conversationId: "conv1",
        prompt: { stepId, type: "QUESTION", inputType, text: "x", ...extra },
        canGoBack: true,
        sections: [],
    };
}

// Cada escenario representa uno de los tipos de mensaje auditados en la
// sección 6 del pedido (A-I) — el que más "sub-flujos de más" recorre antes
// de esta fase es justamente el que más debería beneficiarse.
const SCENARIOS = [
    {
        label: "A. SHORT_TEXT (NAME) — ningún sub-flujo lo reclama",
        resumeConversation: stepState("NAME", "SHORT_TEXT"),
        pending: null,
        handleConversationInput: stepState("DESCRIPTION", "SHORT_TEXT"),
        text: "Fiesta Aniversario",
    },
    {
        label: "D. LOCATION manual (subcampo calle)",
        resumeConversation: stepState("LOCATION", "LOCATION"),
        pending: { id: "p1", conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET", partialData: {} },
        handleConversationInput: stepState("LOCATION", "LOCATION"),
        text: "San Martín",
    },
    {
        label: "H. YES_NO (PROMO_VIDEO_ASK) — 7° de 8 sub-flujos",
        resumeConversation: stepState("PROMO_VIDEO_ASK", "YES_NO"),
        pending: null,
        handleConversationInput: stepState("SOCIAL_LINKS_ASK", "YES_NO"),
        text: "1",
    },
    {
        label: "G. RECURRING SCHEDULES — 6° de 8, 5° de los 5 con pending",
        resumeConversation: stepState("FUNCTIONS_RECURRING_SCHEDULES", "TIME_RANGE_LIST"),
        pending: { id: "p1", conversationId: "conv1", stepId: "FUNCTIONS_RECURRING_SCHEDULES", status: "AWAITING_RECURRING_START_TIME", partialData: { schedules: [], current: {} } },
        handleConversationInput: stepState("FUNCTIONS_LIST", "FUNCTIONS_LIST"),
        text: "20:00",
    },
    {
        label: "I. PREVIEW — el último de los 8 chequeos",
        resumeConversation: { conversationId: "conv1", prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "x", location: null, functions: [], ticketTypes: [] } }, canGoBack: true, sections: [] },
        pending: null,
        handleConversationInput: { conversationId: "conv1", done: true, status: "DRAFT_SAVED", event: { id: "evt1" } },
        text: "2",
    },
];

function buildDeps(scenario) {
    return {
        sendText: spyInstant({ success: true, messageId: "wamid.OUT", error: null }),
        findActiveConversation: spyWithDbLatency({ id: "conv1", userId: "user_123" }),
        resumeConversation: spyWithDbLatency(scenario.resumeConversation),
        handleConversationInput: spyWithDbLatency(scenario.handleConversationInput),
        cancelConversation: spyInstant(undefined),
        getPendingStepInput: spyWithDbLatency(scenario.pending),
        resetPendingStepInput: spyWithDbLatency(scenario.pending),
        updatePendingStepInputStatus: spyWithDbLatency(scenario.pending),
        deletePendingStepInput: spyWithDbLatency(undefined),
    };
}

async function runScenario(scenario) {
    const durations = [];
    for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
        const deps = buildDeps(scenario);
        const startedAt = process.hrtime.bigint();
        await processInboundMessage(textMessage({ text: scenario.text }), deps);
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        durations.push(elapsedMs);
    }
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const p50 = durations[Math.floor(durations.length / 2)];
    return { avg, p50, min: durations[0], max: durations[durations.length - 1] };
}

async function main() {
    console.log(`Benchmark local (mocks, latencia artificial de ${MOCK_DB_LATENCY_MS}ms por lectura) — NO representa producción.\n`);
    for (const scenario of SCENARIOS) {
        const { avg, p50, min, max } = await runScenario(scenario);
        console.log(
            `${scenario.label}\n  avg=${avg.toFixed(1)}ms  p50=${p50.toFixed(1)}ms  min=${min.toFixed(1)}ms  max=${max.toFixed(1)}ms`
        );
    }
}

main();
