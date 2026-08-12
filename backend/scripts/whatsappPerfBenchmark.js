// Fase 3H — benchmark LOCAL y CONTROLADO del overhead interno del adaptador
// WhatsApp, con mocks (sin Postgres/Meta reales). Sirve ÚNICAMENTE para
// comparar el costo arquitectónico de processInboundMessage antes/después de
// la optimización "resumeConversation/getPendingStepInput una sola vez por
// mensaje" — NO representa la latencia real de producción (esa depende de
// la latencia real de Supabase/Render/Meta, que este script no mide).
//
// Fase 3L — se agregan los escenarios A-E pedidos explícitamente (saludo,
// respuesta simple, selección de organización, paso genérico, texto libre),
// incluyendo por primera vez la rama de identificación (sin conversación
// activa: saludo/selección pendiente/descubrimiento por teléfono), que
// hasta esta fase nunca se había medido ni siquiera con mocks.
//
// Se simula un costo artificial por lectura/escritura (resumeConversation/
// getPendingStepInput/getPendingSelection/discoverCandidates/resolveOwner/
// etc.) de MOCK_DB_LATENCY_MS, pensado como una aproximación razonable de un
// round-trip real a Postgres sobre la red (Supabase) — el número en sí es
// arbitrario, lo que importa es la PROPORCIÓN entre escenarios (cuántas
// operaciones secuenciales hace cada uno), no el valor absoluto en ms.
//
// Uso:
//   node scripts/whatsappPerfBenchmark.js
//
// Este script sólo depende de la interfaz pública de processInboundMessage
// (message, deps) — nunca de sus sub-flujos internos — así que sirve tal
// cual para medir CUALQUIER versión del controller.

import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { logger } from "../src/logging/logger.js";

// Silencia el log real ("WhatsApp organizer bot reply sent") que dispara
// cada corrida — son cientos de líneas idénticas por escenario, sin ningún
// valor para leer un benchmark; el resultado que importa es el resumen
// impreso al final de cada escenario (avg/p50/min/max).
logger.info = () => {};
logger.warn = () => {};

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

// Escenarios A-E — exactamente los pedidos en la sección "PASO 3" del
// pedido de Fase 3L. Cada uno declara `active:false` (rama de
// identificación, sin conversación activa todavía) o `active:true` (rama
// normal, conversación ya en curso).
const SCENARIOS = [
    {
        label: "A. Primer mensaje ('Hola', 1 organización, sin selección pendiente)",
        active: false,
        pendingSelection: null,
        candidates: [{ organizationId: "org_1", name: "Bench Org", clerkId: "user_123" }],
        text: "Hola",
    },
    {
        label: "B. Respuesta simple ('1' a un YES_NO en curso) — el escenario crítico",
        active: true,
        resumeConversation: stepState("PROMO_VIDEO_ASK", "YES_NO"),
        pending: null,
        handleConversationInput: stepState("SOCIAL_LINKS_ASK", "YES_NO"),
        text: "1",
    },
    {
        label: "C. Selección de organización ('2', dos organizaciones, AWAITING_SELECTION)",
        active: false,
        pendingSelection: { status: "AWAITING_SELECTION", candidateOrganizationIds: ["org_1", "org_2"] },
        text: "2",
    },
    {
        label: "D. Paso genérico numérico (categoría, SINGLE_SELECT)",
        active: true,
        resumeConversation: stepState("CATEGORY", "SINGLE_SELECT", { options: [{ id: "MUSICA", label: "Música" }] }),
        pending: null,
        handleConversationInput: stepState("COVER_IMAGE", "IMAGE_URL"),
        text: "1",
    },
    {
        label: "E. Input de texto simple (nombre del evento, SHORT_TEXT)",
        active: true,
        resumeConversation: stepState("NAME", "SHORT_TEXT"),
        pending: null,
        handleConversationInput: stepState("DESCRIPTION", "SHORT_TEXT"),
        text: "Fiesta Aniversario",
    },
    // Escenarios adicionales de Fase 3H, conservados para no perder esa
    // referencia histórica (el punto de comparación original de esa fase).
    {
        label: "F. LOCATION manual (subcampo calle)",
        active: true,
        resumeConversation: stepState("LOCATION", "LOCATION"),
        pending: { id: "p1", conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET", partialData: {} },
        handleConversationInput: stepState("LOCATION", "LOCATION"),
        text: "San Martín",
    },
    {
        label: "G. RECURRING SCHEDULES — 6° de 8, 5° de los 5 con pending",
        active: true,
        resumeConversation: stepState("FUNCTIONS_RECURRING_SCHEDULES", "TIME_RANGE_LIST"),
        pending: { id: "p1", conversationId: "conv1", stepId: "FUNCTIONS_RECURRING_SCHEDULES", status: "AWAITING_RECURRING_START_TIME", partialData: { schedules: [], current: {} } },
        handleConversationInput: stepState("FUNCTIONS_LIST", "FUNCTIONS_LIST"),
        text: "20:00",
    },
    {
        label: "H. PREVIEW — el último de los 8 chequeos",
        active: true,
        resumeConversation: { conversationId: "conv1", prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "x", location: null, functions: [], ticketTypes: [] } }, canGoBack: true, sections: [] },
        pending: null,
        handleConversationInput: { conversationId: "conv1", done: true, status: "DRAFT_SAVED", event: { id: "evt1" } },
        text: "2",
    },
];

function buildDeps(scenario) {
    return {
        sendText: spyInstant({ success: true, messageId: "wamid.OUT", error: null }),
        findActiveConversation: spyWithDbLatency(scenario.active ? { id: "conv1", userId: "user_123" } : null),
        resumeConversation: spyWithDbLatency(scenario.resumeConversation),
        handleConversationInput: spyWithDbLatency(scenario.handleConversationInput),
        cancelConversation: spyInstant(undefined),
        getPendingStepInput: spyWithDbLatency(scenario.pending),
        resetPendingStepInput: spyWithDbLatency(scenario.pending),
        updatePendingStepInputStatus: spyWithDbLatency(scenario.pending),
        deletePendingStepInput: spyWithDbLatency(undefined),
        // Rama de identificación (Escenarios A/C) — sin conversación activa.
        getPendingSelection: spyWithDbLatency(scenario.pendingSelection ?? null),
        discoverCandidates: spyWithDbLatency(scenario.candidates ?? []),
        resolveOwner: spyWithDbLatency({ name: "Bench Org 2", clerkId: "user_123" }),
        confirmSelection: spyWithDbLatency(undefined),
        createPendingSelection: spyWithDbLatency(undefined),
        clearPendingSelection: spyWithDbLatency(undefined),
        startConversation: spyWithDbLatency({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "x" }, canGoBack: false, sections: [] }),
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
    console.log(`Benchmark local (mocks, latencia artificial de ${MOCK_DB_LATENCY_MS}ms por lectura/escritura) — NO representa producción.\n`);
    for (const scenario of SCENARIOS) {
        const { avg, p50, min, max } = await runScenario(scenario);
        console.log(
            `${scenario.label}\n  avg=${avg.toFixed(1)}ms  p50=${p50.toFixed(1)}ms  min=${min.toFixed(1)}ms  max=${max.toFixed(1)}ms`
        );
    }
}

main();
