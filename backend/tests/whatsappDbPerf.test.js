import test from "node:test";
import assert from "node:assert/strict";
import { logger } from "../src/logging/logger.js";
import { startWhatsappPerfTimer, enterWithActiveTimer, instrumentPrismaClient } from "../src/utils/whatsappPerf.js";

// Fase 3N — desglose fino de operaciones Prisma dentro de [WA_PERF]
// (`dbCalls`/`recordDbCall`/`instrumentPrismaClient`/`enterWithActiveTimer`).
// `instrumentPrismaClient` se prueba acá con un cliente FALSO que imita
// exactamente el contrato real de una extensión de Prisma
// (`$extends({query:{$allModels:{$allOperations}}})`) — no requiere
// Postgres real (mismo criterio que el resto del proyecto: ningún service
// que toca Prisma de verdad tiene test con mocks de Prisma; acá se prueba
// la lógica de instrumentación en sí, que es agnóstica de qué base de
// datos hay detrás).

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

// Cliente falso mínimo que implementa el mismo contrato de extensión que
// Prisma real expone — permite ejercitar `instrumentPrismaClient` de
// verdad (no un doble simplificado de esa función) sin ninguna base de
// datos real detrás.
function fakePrismaClient({ delayMs = 0, throwError = null } = {}) {
    return {
        $extends({ query }) {
            const allOperations = query.$allModels.$allOperations;
            return {
                async runFakeQuery(model, operation, args) {
                    return allOperations({
                        model,
                        operation,
                        args,
                        query: async () => {
                            if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
                            if (throwError) throw throwError;
                            return { ok: true };
                        },
                    });
                },
            };
        },
    };
}

test("recordDbCall/finish: dbCalls, dbCallCount and dbTotalMs appear in the [WA_PERF] payload when enabled", async () => {
    await withPerfEnv(async () => {
        await withPerfLogCapture(async (calls) => {
            const timer = startWhatsappPerfTimer();
            timer.recordDbCall("conversationState.findFirst", 12.3);
            timer.recordDbCall("event.create", 45.6);
            timer.finish({ conversationId: "conv_abcdef123", engineAction: "TEST" });

            const perfLog = calls.find((c) => c.message === "[WA_PERF]");
            assert.ok(perfLog);
            assert.equal(perfLog.context.dbCallCount, 2);
            assert.equal(perfLog.context.dbTotalMs, 57.9);
            assert.deepEqual(perfLog.context.dbCalls, [
                { label: "conversationState.findFirst", ms: 12.3 },
                { label: "event.create", ms: 45.6 },
            ]);
        });
    });
});

test("recordDbCall is a no-op when WHATSAPP_PERF_LOG is disabled — never grows dbCalls, never logs", async () => {
    const originalEnv = process.env.WHATSAPP_PERF_LOG;
    delete process.env.WHATSAPP_PERF_LOG;
    try {
        await withPerfLogCapture(async (calls) => {
            const timer = startWhatsappPerfTimer();
            timer.recordDbCall("event.create", 999);
            timer.finish({ conversationId: "conv1" });
            assert.equal(calls.filter((c) => c.message === "[WA_PERF]").length, 0);
        });
    } finally {
        if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
        else process.env.WHATSAPP_PERF_LOG = originalEnv;
    }
});

test("recordDbCall caps at MAX_DB_CALLS_RECORDED (200) — a runaway loop never grows the log without bound", async () => {
    await withPerfEnv(async () => {
        await withPerfLogCapture(async (calls) => {
            const timer = startWhatsappPerfTimer();
            for (let i = 0; i < 250; i++) {
                timer.recordDbCall("event.findMany", 1);
            }
            timer.finish({ conversationId: "conv1" });
            const perfLog = calls.find((c) => c.message === "[WA_PERF]");
            assert.equal(perfLog.context.dbCallCount, 200);
        });
    });
});

test("instrumentPrismaClient: with an active timer and perf enabled, records model.operation and a real duration — never the query arguments", async () => {
    await withPerfEnv(async () => {
        await withPerfLogCapture(async (calls) => {
            const timer = startWhatsappPerfTimer();
            const instrumented = instrumentPrismaClient(fakePrismaClient({ delayMs: 5 }));

            enterWithActiveTimer(timer);
            await instrumented.runFakeQuery("ConversationState", "findFirst", {
                where: { channelRef: "5491122334455", waId: "5491122334455" },
            });

            timer.finish({ conversationId: "conv1" });
            const perfLog = calls.find((c) => c.message === "[WA_PERF]");
            assert.equal(perfLog.context.dbCallCount, 1);
            assert.equal(perfLog.context.dbCalls[0].label, "ConversationState.findFirst");
            assert.ok(perfLog.context.dbCalls[0].ms >= 4, "debería reflejar la demora real simulada (~5ms)");

            const serialized = JSON.stringify(perfLog);
            assert.ok(!serialized.includes("5491122334455"), "nunca debe filtrar los argumentos de la query (teléfono)");
        });
    });
});

test("instrumentPrismaClient: without an active timer (no enterWithActiveTimer called), never throws and still returns the real result", async () => {
    await withPerfEnv(async () => {
        const instrumented = instrumentPrismaClient(fakePrismaClient());
        const result = await instrumented.runFakeQuery("Event", "create", { data: { title: "x" } });
        assert.deepEqual(result, { ok: true });
    });
});

test("instrumentPrismaClient: when WHATSAPP_PERF_LOG is disabled, never touches the timer and adds no measurable overhead path", async () => {
    const originalEnv = process.env.WHATSAPP_PERF_LOG;
    delete process.env.WHATSAPP_PERF_LOG;
    try {
        const timer = startWhatsappPerfTimer();
        const instrumented = instrumentPrismaClient(fakePrismaClient());
        enterWithActiveTimer(timer);
        const result = await instrumented.runFakeQuery("Event", "create", { data: { title: "x" } });
        assert.deepEqual(result, { ok: true });
        // El timer nunca se activó (enabled:false), así que nunca hubo
        // trabajo real de instrumentación — no hay forma de observar esto
        // desde afuera salvo confirmando que el resultado real es idéntico.
    } finally {
        if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
        else process.env.WHATSAPP_PERF_LOG = originalEnv;
    }
});

test("instrumentPrismaClient: a query that throws still propagates the real error, and is never swallowed by the instrumentation", async () => {
    await withPerfEnv(async () => {
        const boom = new Error("simulated Prisma error");
        const instrumented = instrumentPrismaClient(fakePrismaClient({ throwError: boom }));
        const timer = startWhatsappPerfTimer();
        enterWithActiveTimer(timer);
        await assert.rejects(() => instrumented.runFakeQuery("Event", "create", { data: {} }), /simulated Prisma error/);
    });
});

// Fase 3N, PASO 3 del pedido — dos mensajes procesados "en paralelo" (como
// haría Promise.allSettled en processInboundMessages) nunca deben mezclar
// sus queries: cada uno arma su propio contexto asíncrono.
test("two concurrent active timers never leak dbCalls into each other", async () => {
    await withPerfEnv(async () => {
        const instrumented = instrumentPrismaClient(fakePrismaClient({ delayMs: 10 }));

        async function runOne(label) {
            const timer = startWhatsappPerfTimer();
            enterWithActiveTimer(timer);
            await instrumented.runFakeQuery("Event", label, {});
            return timer;
        }

        const [timerA, timerB] = await Promise.all([runOne("findFirst"), runOne("findUnique")]);

        await withPerfLogCapture(async (calls) => {
            timerA.finish({ conversationId: "convA" });
            timerB.finish({ conversationId: "convB" });
            const logA = calls.find((c) => c.context?.conv === "convA");
            const logB = calls.find((c) => c.context?.conv === "convB");
            assert.equal(logA.context.dbCallCount, 1);
            assert.equal(logA.context.dbCalls[0].label, "Event.findFirst");
            assert.equal(logB.context.dbCallCount, 1);
            assert.equal(logB.context.dbCalls[0].label, "Event.findUnique");
        });
    });
});
