import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { logger } from "../src/logging/logger.js";

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

// ==================================================
// Fase 3L — auditoría de performance: la rama de identificación (sin
// conversación activa todavía: saludo, selección pendiente, descubrimiento
// por teléfono) no tenía NINGUNA marca [WA_PERF] — quedaba invisible,
// exactamente el camino de los escenarios señalados como lentos (saludo
// inicial, "1" a "¿querés publicar?", elegir organización). Estos tests
// prenden WHATSAPP_PERF_LOG=true de verdad y capturan logger.info (no hay
// otra forma de observarlo: el timer se crea internamente, no se inyecta)
// para confirmar que ahora SÍ quedan marcadas, que activarlo/desactivarlo
// nunca cambia ningún resultado, y que la línea [WA_PERF] nunca contiene
// PII (teléfono, texto del usuario, nombre).
// ==================================================

function withPerfLogCapture(run) {
    const originalEnv = process.env.WHATSAPP_PERF_LOG;
    const originalInfo = logger.info;
    const calls = [];
    logger.info = (message, context) => {
        calls.push({ message, context });
    };
    process.env.WHATSAPP_PERF_LOG = "true";
    return run(calls).finally(() => {
        logger.info = originalInfo;
        if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
        else process.env.WHATSAPP_PERF_LOG = originalEnv;
    });
}

function identityDeps(overrides = {}) {
    return {
        sendText: async () => ({ success: true, messageId: "wamid.OUT1", error: null }),
        findActiveConversation: async () => null,
        getPendingSelection: async () => null,
        discoverCandidates: async () => [{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }],
        startConversation: async () => ({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" }, canGoBack: false, sections: [] }),
        createPendingSelection: async () => undefined,
        clearPendingSelection: async () => undefined,
        resolveOwner: async () => ({ name: "Elvis Bar", clerkId: "user_123" }),
        ...overrides,
    };
}

function textMessageFrom(text, from = "5491122334455") {
    return textMessage({ text, from });
}

// sendBotReply loguea DOS líneas por respuesta ("WhatsApp organizer bot
// reply sent" y, si WHATSAPP_PERF_LOG está activo, "[WA_PERF]") — ambas
// pasan por logger.info, así que hay que filtrar la de perf explícitamente
// en vez de asumir que es la primera.
function findPerfLog(calls) {
    return calls.find((c) => c.message === "[WA_PERF]");
}

test("with WHATSAPP_PERF_LOG=true, a greeting message (no pending, no active conversation) logs a [WA_PERF] line with PENDING_SELECTION_READ and DISCOVER marks", async () => {
    await withPerfLogCapture(async (calls) => {
        await processInboundMessage(textMessageFrom("Hola"), identityDeps());

        const perfLog = findPerfLog(calls);
        assert.ok(perfLog, "esperaba una línea [WA_PERF]");
        const markNames = perfLog.context.marks.map((m) => m.name);
        assert.ok(markNames.includes("PENDING_SELECTION_READ"), `esperaba PENDING_SELECTION_READ en ${JSON.stringify(markNames)}`);
        assert.ok(markNames.includes("DISCOVER"), `esperaba DISCOVER en ${JSON.stringify(markNames)}`);
        assert.ok(markNames.includes("BUILD_REPLY"));
        assert.ok(markNames.includes("META_SEND"));
    });
});

// Bug fix (confirmación redundante): elegir una organización del selector
// ahora arranca EventCreationEngine en el MISMO mensaje — ya no hace falta
// un segundo mensaje "Sí" para llegar a START (ver
// tests/whatsapp.organizerBot.test.js para la cobertura funcional
// completa). RESOLVE_OWNER/CLEAR_SELECTION/START quedan todos marcados acá.
test("with WHATSAPP_PERF_LOG=true, selecting an organization (AWAITING_SELECTION) logs RESOLVE_OWNER, CLEAR_SELECTION and START marks in the same message", async () => {
    await withPerfLogCapture(async (calls) => {
        await processInboundMessage(
            textMessageFrom("2"),
            identityDeps({ getPendingSelection: async () => ({ status: "AWAITING_SELECTION", candidateOrganizationIds: ["org_1", "org_2"] }) })
        );

        const markNames = findPerfLog(calls).context.marks.map((m) => m.name);
        assert.ok(markNames.includes("PENDING_SELECTION_READ"));
        assert.ok(markNames.includes("RESOLVE_OWNER"));
        assert.ok(markNames.includes("CLEAR_SELECTION"));
        assert.ok(markNames.includes("START"));
    });
});

test("perf instrumentation never logs the phone number, the raw message text, or the organization/person name", async () => {
    await withPerfLogCapture(async (calls) => {
        await processInboundMessage(
            textMessageFrom("2", "5491100009999"),
            identityDeps({ getPendingSelection: async () => ({ status: "AWAITING_SELECTION", candidateOrganizationIds: ["org_1", "org_2"] }) })
        );

        const serialized = JSON.stringify(calls);
        assert.ok(!serialized.includes("5491100009999"), "el teléfono nunca debe aparecer en el log de perf");
        assert.ok(!serialized.includes("Elvis Bar"), "el nombre de la organización nunca debe aparecer en el log de perf");
    });
});

test("WHATSAPP_PERF_LOG defaults to disabled: no [WA_PERF] line is logged, and the reply/behavior is unaffected", async () => {
    const originalEnv = process.env.WHATSAPP_PERF_LOG;
    delete process.env.WHATSAPP_PERF_LOG;
    const originalInfo = logger.info;
    const calls = [];
    logger.info = (message, context) => calls.push({ message, context });

    const sendCalls = [];
    try {
        await processInboundMessage(
            textMessageFrom("Hola"),
            identityDeps({ sendText: async (args) => { sendCalls.push(args); return { success: true, messageId: "wamid.OUT1", error: null }; } })
        );
    } finally {
        logger.info = originalInfo;
        if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
        else process.env.WHATSAPP_PERF_LOG = originalEnv;
    }

    assert.equal(calls.filter((c) => c.message === "[WA_PERF]").length, 0, "sin la variable de entorno, nunca debe loguearse [WA_PERF]");
    assert.equal(sendCalls.length, 1, "el comportamiento real (responder) es idéntico esté o no la instrumentación activa");
});

test("enabling WHATSAPP_PERF_LOG never changes which reply is sent (same text, same engineAction path)", async () => {
    const runOnce = async (perfEnabled) => {
        const originalEnv = process.env.WHATSAPP_PERF_LOG;
        if (perfEnabled) process.env.WHATSAPP_PERF_LOG = "true";
        else delete process.env.WHATSAPP_PERF_LOG;

        const sendCalls = [];
        try {
            await processInboundMessage(
                textMessageFrom("2"),
                identityDeps({
                    getPendingSelection: async () => ({ status: "AWAITING_SELECTION", candidateOrganizationIds: ["org_1", "org_2"] }),
                    sendText: async (args) => { sendCalls.push(args); return { success: true, messageId: "wamid.OUT1", error: null }; },
                })
            );
        } finally {
            if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
            else process.env.WHATSAPP_PERF_LOG = originalEnv;
        }
        return sendCalls[0]?.text;
    };

    const withPerfOff = await runOnce(false);
    const withPerfOn = await runOnce(true);
    assert.equal(withPerfOff, withPerfOn);
});
