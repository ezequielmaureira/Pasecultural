import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/config/prisma.js";
import {
    getPendingStepInput,
    getValidPendingStepInput,
    createPendingStepInput,
    updatePendingStepInputStatus,
    deletePendingStepInput,
    resetPendingStepInput,
} from "../src/services/whatsappPendingStepInput.service.js";
import { logger } from "../src/logging/logger.js";
import { startWhatsappPerfTimer, enterWithActiveTimer } from "../src/utils/whatsappPerf.js";

// Fase 3B — este service es CRUD puro contra Postgres real: create/update/
// delete/CASCADE/aislamiento entre filas no son expresables como funciones
// puras (mismo criterio que el resto del proyecto — ningún service que
// toca Prisma tiene test unitario con mocks, ver informe de Fase 2G). Estos
// tests necesitan una base real, así que se saltan limpiamente (nunca
// fallan) cuando no hay DATABASE_URL configurada — el caso normal de
// `node --test` en este sandbox. Se corrieron una vez, de verdad, contra un
// PostgreSQL descartable (ver informe de entrega) para probar cada
// escenario end-to-end.
// Guardrail centralizado — ver tests/helpers/dbGuard.js (nunca reemplazar
// por `Boolean(process.env.DATABASE_URL)` acá, ver ese archivo para el
// motivo).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

async function createConversationState(overrides = {}) {
    return prisma.conversationState.create({
        data: {
            channel: "WHATSAPP",
            channelRef: "5491100000000",
            currentStepId: "FUNCTIONS_SINGLE_CARD",
            ...overrides,
        },
    });
}

async function deleteConversationState(id) {
    await prisma.conversationState.deleteMany({ where: { id } });
}

// 1) creación de pending
testWithDb("createPendingStepInput persists a new pending row", async () => {
    const conv = await createConversationState();
    try {
        const pending = await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE");
        assert.equal(pending.conversationId, conv.id);
        assert.equal(pending.stepId, "FUNCTIONS_SINGLE_CARD");
        assert.equal(pending.status, "AWAITING_DATE");
        assert.deepEqual(pending.partialData, {});
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 2) lectura por conversationId
testWithDb("getPendingStepInput reads it back by conversationId", async () => {
    const conv = await createConversationState();
    try {
        await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE", { date: "2026-08-25" });
        const pending = await getPendingStepInput(conv.id);
        assert.equal(pending.status, "AWAITING_DATE");
        assert.deepEqual(pending.partialData, { date: "2026-08-25" });
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 3) actualización de subStep/status
testWithDb("updatePendingStepInputStatus advances the sub-step", async () => {
    const conv = await createConversationState();
    try {
        await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE", { date: "2026-08-25" });
        const updated = await updatePendingStepInputStatus(conv.id, "AWAITING_START_TIME", { date: "2026-08-25" });
        assert.equal(updated.status, "AWAITING_START_TIME");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 4) actualización de partialData
testWithDb("updatePendingStepInputStatus overwrites partialData with exactly what the caller passes", async () => {
    const conv = await createConversationState();
    try {
        await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_START_TIME", { date: "2026-08-25" });
        const updated = await updatePendingStepInputStatus(conv.id, "AWAITING_END_TIME", {
            date: "2026-08-25",
            startTime: "20:00",
        });
        assert.deepEqual(updated.partialData, { date: "2026-08-25", startTime: "20:00" });
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 5) eliminación
testWithDb("deletePendingStepInput removes it", async () => {
    const conv = await createConversationState();
    try {
        await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE");
        await deletePendingStepInput(conv.id);
        assert.equal(await getPendingStepInput(conv.id), null);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("deletePendingStepInput is idempotent when nothing exists", async () => {
    const conv = await createConversationState();
    try {
        await assert.doesNotReject(() => deletePendingStepInput(conv.id));
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 6) reset/reemplazo cuando cambia stepId
testWithDb("resetPendingStepInput discards the old pending and starts fresh for a new step", async () => {
    const conv = await createConversationState();
    try {
        await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_END_TIME", {
            date: "2026-08-25",
            startTime: "20:00",
        });

        const reset = await resetPendingStepInput(conv.id, "LOCATION", "AWAITING_STREET");

        assert.equal(reset.stepId, "LOCATION");
        assert.equal(reset.status, "AWAITING_STREET");
        assert.deepEqual(reset.partialData, {});

        const current = await getPendingStepInput(conv.id);
        assert.equal(current.id, reset.id, "sólo debe quedar UN pending por conversación después del reset");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// Fase 4 (optimización de latencia) — resetPendingStepInput pasó de
// deleteMany+create (dos escrituras) a un único upsert. Se prueba con la
// misma instrumentación real de Fase 3N (instrumentPrismaClient, activa
// siempre en config/prisma.js, no-op salvo WHATSAPP_PERF_LOG=true) para
// contar cuántas operaciones Prisma reales dispara — no hace falta mockear
// nada, es exactamente el mismo mecanismo que ya usa [WA_PERF] en
// producción.
// ==================================================================

function withPerfEnv(run) {
    const originalEnv = process.env.WHATSAPP_PERF_LOG;
    process.env.WHATSAPP_PERF_LOG = "true";
    return run().finally(() => {
        if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
        else process.env.WHATSAPP_PERF_LOG = originalEnv;
    });
}

function withPerfLogCapture(run) {
    const originalInfo = logger.info;
    const calls = [];
    logger.info = (message, context) => calls.push({ message, context });
    return run(calls).finally(() => {
        logger.info = originalInfo;
    });
}

// 6) reset usa una sola escritura — tanto para inicializar como para
// reemplazar un pending ya existente.
testWithDb("6) resetPendingStepInput writes exactly once (a single upsert), never deleteMany + create", async () => {
    const conv = await createConversationState();
    try {
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);

                // Caso A: no había ningún pending todavía (inicializar).
                await resetPendingStepInput(conv.id, "LOCATION", "AWAITING_STREET");
                // Caso B: ya había un pending de este mismo step (reemplazar).
                await resetPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE", { date: "2026-08-25" });

                timer.finish({ conversationId: conv.id });
                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                const labels = dbCalls.map((c) => c.label.toLowerCase());

                assert.equal(labels.filter((l) => l === "whatsapppendingstepinput.upsert").length, 2, `esperaba 2 upserts (uno por llamada), dbCalls: ${JSON.stringify(dbCalls)}`);
                assert.ok(!labels.includes("whatsapppendingstepinput.deletemany"), "resetPendingStepInput nunca debe disparar deleteMany");
                assert.ok(!labels.includes("whatsapppendingstepinput.create"), "resetPendingStepInput nunca debe disparar create por separado");

                const current = await getPendingStepInput(conv.id);
                assert.equal(current.stepId, "FUNCTIONS_SINGLE_CARD", "el segundo reset debe haber reemplazado por completo al primero");
                assert.deepEqual(current.partialData, { date: "2026-08-25" });
            })
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 7) los deletes reales siguen eliminando el pending — deletePendingStepInput
// (usado cuando el comportamiento pedido es realmente "no hay más pending",
// nunca "reemplazar por otro step") no se tocó: sigue siendo un deleteMany
// real, cubierto arriba por "deletePendingStepInput removes it" /
// "...is idempotent when nothing exists". Este test conecta explícitamente
// ambos comportamientos: reset reemplaza con upsert, delete sigue borrando.
testWithDb("7) resetPendingStepInput replaces via upsert, but deletePendingStepInput still genuinely deletes the row", async () => {
    const conv = await createConversationState();
    try {
        await resetPendingStepInput(conv.id, "LOCATION", "AWAITING_STREET");
        assert.ok(await getPendingStepInput(conv.id), "debe existir tras el reset");

        await deletePendingStepInput(conv.id);
        assert.equal(await getPendingStepInput(conv.id), null, "delete real debe seguir dejando la conversación sin ningún pending");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 7) no reutilización de pending de otro step
testWithDb("getValidPendingStepInput never returns a pending that belongs to a different step", async () => {
    const conv = await createConversationState();
    try {
        await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE");

        assert.equal(await getValidPendingStepInput(conv.id, "LOCATION"), null);
        assert.ok(await getValidPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD"));
    } finally {
        await deleteConversationState(conv.id);
    }
});

// 8) aislamiento entre dos conversationId
testWithDb("two different conversations never share or interfere with each other's pending", async () => {
    const convA = await createConversationState({ channelRef: "5491100000001" });
    const convB = await createConversationState({ channelRef: "5491100000002" });
    try {
        await createPendingStepInput(convA.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE", { date: "2026-08-25" });
        await createPendingStepInput(convB.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_START_TIME", { date: "2026-09-01" });

        const pendingA = await getPendingStepInput(convA.id);
        const pendingB = await getPendingStepInput(convB.id);

        assert.equal(pendingA.status, "AWAITING_DATE");
        assert.equal(pendingB.status, "AWAITING_START_TIME");
        assert.deepEqual(pendingA.partialData, { date: "2026-08-25" });
        assert.deepEqual(pendingB.partialData, { date: "2026-09-01" });

        await deletePendingStepInput(convA.id);
        assert.equal(await getPendingStepInput(convA.id), null);
        assert.ok(await getPendingStepInput(convB.id), "borrar el pending de A nunca debe afectar a B");
    } finally {
        await deleteConversationState(convA.id);
        await deleteConversationState(convB.id);
    }
});

// 9) estructura de partialData no se comparte accidentalmente
testWithDb("mutating the original partialData object after saving never leaks into what was persisted", async () => {
    const convA = await createConversationState({ channelRef: "5491100000003" });
    const convB = await createConversationState({ channelRef: "5491100000004" });
    try {
        const original = { date: "2026-08-25" };
        await createPendingStepInput(convA.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_START_TIME", original);
        original.date = "MUTATED";
        await createPendingStepInput(convB.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_START_TIME", { date: "2026-09-01" });

        const pendingA = await getPendingStepInput(convA.id);
        assert.equal(pendingA.partialData.date, "2026-08-25");
    } finally {
        await deleteConversationState(convA.id);
        await deleteConversationState(convB.id);
    }
});

// 10) comportamiento esperado ante pending inexistente
testWithDb("reading a pending that was never created returns null, never throws", async () => {
    const conv = await createConversationState();
    try {
        assert.equal(await getPendingStepInput(conv.id), null);
        assert.equal(await getValidPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD"), null);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("updating a pending that doesn't exist fails explicitly instead of silently creating one", async () => {
    const conv = await createConversationState();
    try {
        await assert.rejects(() => updatePendingStepInputStatus(conv.id, "AWAITING_DATE", {}));
    } finally {
        await deleteConversationState(conv.id);
    }
});

// CASCADE — secciones 6/9 del pedido: borrar la ConversationState (mismo
// mecanismo real que EventCreationEngine.cancel -> prisma.conversationState.delete)
// debe hacer desaparecer el pending asociado SOLO, sin limpieza manual.
testWithDb("deleting the ConversationState cascades and removes its pending automatically", async () => {
    const conv = await createConversationState({ channelRef: "5491100000005" });
    await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE");

    await prisma.conversationState.delete({ where: { id: conv.id } });

    const pending = await prisma.whatsappPendingStepInput.findUnique({ where: { conversationId: conv.id } });
    assert.equal(pending, null);
});

testWithDb("at most one pending row can exist per ConversationState", async () => {
    const conv = await createConversationState();
    try {
        await createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE");
        await assert.rejects(() => createPendingStepInput(conv.id, "FUNCTIONS_SINGLE_CARD", "AWAITING_DATE"));
    } finally {
        await deleteConversationState(conv.id);
    }
});
