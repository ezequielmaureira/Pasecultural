import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import * as EventCreationEngine from "../src/conversation/EventCreationEngine.js";
import { logger } from "../src/logging/logger.js";
import { startWhatsappPerfTimer, enterWithActiveTimer } from "../src/utils/whatsappPerf.js";
import {
    enterWithConversationStateRequestCache,
    getCachedConversationState,
} from "../src/conversation/conversationStateRequestCache.js";

// Fase 4 (optimización de latencia) — EventCreationEngine toca Prisma real
// (create/update/findUnique/findFirst no son expresables como funciones
// puras, mismo criterio que el resto del proyecto — ningún service que toca
// Prisma tiene test unitario con mocks, ver whatsappOrganizerDiscovery.test.js).
// Se corre contra backend/.env.test (proyecto TEST de Supabase), nunca
// contra producción — ver tests/helpers/dbGuard.js.
//
// Para "contar" cuántas veces se dispara ConversationState.findUnique
// dentro de un mismo mensaje se reutiliza la instrumentación YA EXISTENTE
// de Fase 3N (instrumentPrismaClient, activa siempre en config/prisma.js,
// no-op salvo WHATSAPP_PERF_LOG=true): se prende el flag, se activa un
// timer con enterWithActiveTimer y se lee el desglose real de dbCalls que
// [WA_PERF] ya expone — no hace falta ninguna infraestructura de test
// nueva para esto, ni mockear Prisma.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

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

function countCalls(dbCalls, label) {
    return dbCalls.filter((c) => c.label.toLowerCase() === label.toLowerCase()).length;
}

async function createConversationState(overrides = {}) {
    const suffix = randomUUID().slice(0, 8);
    return prisma.conversationState.create({
        data: {
            channel: "WHATSAPP",
            channelRef: `5491100${suffix}`,
            currentStepId: "NAME",
            draftEvent: {},
            history: ["NAME"],
            status: "ACTIVE",
            ...overrides,
        },
    });
}

async function deleteConversationState(id) {
    await prisma.conversationState.deleteMany({ where: { id } });
}

// ==================================================================
// 1) Un paso habitual (resume + handleInput, exactamente lo que hace
// processInboundMessage para cualquier step "plano") no repite
// ConversationState.findUnique para el mismo id.
// ==================================================================

testWithDb("1) resume() + handleInput() for the same message read ConversationState exactly once, not twice", async () => {
    const conv = await createConversationState();
    try {
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);
                enterWithConversationStateRequestCache();

                await EventCreationEngine.resume(conv.id);
                const result = await EventCreationEngine.handleInput(conv.id, { value: "Fiesta de Prueba" });
                timer.finish({ conversationId: conv.id });

                assert.equal(result.prompt.stepId, "DESCRIPTION", "la transición del motor no cambia");

                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(
                    countCalls(dbCalls, "conversationState.findUnique"),
                    1,
                    `esperaba 1 sola lectura, dbCalls: ${JSON.stringify(dbCalls)}`
                );
            })
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// 2) El estado actualizado por handleInput se reutiliza dentro del mismo
// mensaje: un resume() posterior (ej. otro sub-flujo que vuelva a mirar el
// estado) ve el draft/step YA actualizado, sin volver a leer Prisma.
// ==================================================================

testWithDb("2) after handleInput writes, a later resume() in the same message sees the fresh state without any extra findUnique", async () => {
    const conv = await createConversationState();
    try {
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);
                enterWithConversationStateRequestCache();

                await EventCreationEngine.resume(conv.id);
                await EventCreationEngine.handleInput(conv.id, { value: "Fiesta de Prueba" });
                const after = await EventCreationEngine.resume(conv.id);
                timer.finish({ conversationId: conv.id });

                assert.equal(after.prompt.stepId, "DESCRIPTION", "el segundo resume() debe ver el step YA avanzado");

                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(
                    countCalls(dbCalls, "conversationState.findUnique"),
                    1,
                    "el resume() final no debe agregar ninguna lectura nueva — reutiliza la copia que dejó handleInput"
                );
            })
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// 5) La ausencia de conversación mantiene el comportamiento actual — con o
// sin el contexto de cache activo.
// ==================================================================

testWithDb("5) resume()/handleInput() with a conversationId that doesn't exist still throw CONVERSATION_NOT_FOUND, same as before", async () => {
    const missingId = `missing_${randomUUID()}`;
    enterWithConversationStateRequestCache();

    await assert.rejects(() => EventCreationEngine.resume(missingId), /CONVERSATION_NOT_FOUND/);
    await assert.rejects(() => EventCreationEngine.handleInput(missingId, { value: "x" }), /CONVERSATION_NOT_FOUND/);
});

testWithDb("5b) a CLOSED conversation (status !== ACTIVE) still throws CONVERSATION_CLOSED from handleInput, same as before", async () => {
    const conv = await createConversationState({ status: "PUBLISHED" });
    try {
        enterWithConversationStateRequestCache();
        await assert.rejects(() => EventCreationEngine.handleInput(conv.id, { value: "x" }), /CONVERSATION_CLOSED/);
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// 12) Web nunca entra al contexto de cache (conversation.controller.js no
// llama a enterWithConversationStateRequestCache) — su comportamiento y su
// cantidad de queries deben quedar EXACTAMENTE iguales a como eran antes de
// este cambio: dos lecturas independientes para resume() + handleInput().
// ==================================================================

testWithDb("12) without entering the cache context (the Web path), resume() + handleInput() still read ConversationState twice — zero behavior change for Web", async () => {
    const conv = await createConversationState();
    try {
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);
                // A propósito: NUNCA se llama enterWithConversationStateRequestCache
                // acá — así se comporta conversation.controller.js hoy.

                const before = await EventCreationEngine.resume(conv.id);
                const result = await EventCreationEngine.handleInput(conv.id, { value: "Fiesta de Prueba" });
                timer.finish({ conversationId: conv.id });

                assert.equal(before.prompt.stepId, "NAME");
                assert.equal(result.prompt.stepId, "DESCRIPTION");

                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(
                    countCalls(dbCalls, "conversationState.findUnique"),
                    2,
                    "sin contexto de cache activo, el comportamiento de Web debe seguir siendo exactamente el de antes (2 lecturas)"
                );
            })
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// Bonus — la salvaguarda de concurrencia real que exige el pedido ("No
// ocultar conflictos reales de concurrencia"): si otro proceso cierra la
// conversación ENTRE la lectura cacheada y la escritura, handleInput debe
// seguir detectándolo y nunca escribir sobre la fila ya cerrada.
// ==================================================================

testWithDb("a conversation closed by another process between the cached read and the write is detected, never silently overwritten", async () => {
    const conv = await createConversationState();
    try {
        enterWithConversationStateRequestCache();

        // Este resume() cachea la copia ACTIVE.
        await EventCreationEngine.resume(conv.id);

        // Simula OTRO mensaje concurrente que publica/cierra la conversación
        // justo en el medio — nunca pasa por la cache de este contexto.
        await prisma.conversationState.update({ where: { id: conv.id }, data: { status: "PUBLISHED" } });

        // handleInput todavía tiene la copia vieja (ACTIVE) cacheada, pero la
        // escritura real debe detectar que la fila ya no está ACTIVE.
        await assert.rejects(() => EventCreationEngine.handleInput(conv.id, { value: "x" }), /CONVERSATION_CLOSED/);

        const stored = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(stored.currentStepId, "NAME", "la escritura conflictiva nunca debe haberse aplicado");
        assert.equal(stored.status, "PUBLISHED", "el status real (puesto por el otro proceso) nunca se pisa");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// FASE 2B (PASO 2) — findActiveConversation() deja de traer un `select`
// parcial y cachea la fila completa, para que resume() (llamado siempre a
// continuación por whatsapp.controller.js) no vuelva a pagar su propio
// findUnique. Los tests de más arriba (Fase 4) ya prueban readConversationState/
// applyConversationUpdate en general; estos prueban específicamente el nuevo
// comportamiento de findActiveConversation.
// ==================================================================

testWithDb("FASE 2B.1) findActiveConversation() within a cache context caches the FULL row (currentStepId/draftEvent/history/status), but its own return value keeps the old limited shape", async () => {
    const conv = await createConversationState({ draftEvent: { name: "Test" } });
    try {
        enterWithConversationStateRequestCache();
        const active = await EventCreationEngine.findActiveConversation({ channel: "WHATSAPP", channelRef: conv.channelRef });

        assert.deepEqual(
            active,
            { id: conv.id, userId: null, organizationId: null },
            "el contrato público no cambia: sigue devolviendo sólo id/userId/organizationId, nunca la fila completa"
        );

        const cached = getCachedConversationState(conv.id);
        assert.ok(cached, "debe quedar cacheada para el resto del mensaje");
        assert.equal(cached.id, conv.id);
        assert.equal(cached.currentStepId, "NAME");
        assert.deepEqual(cached.draftEvent, { name: "Test" });
        assert.deepEqual(cached.history, ["NAME"]);
        assert.equal(cached.status, "ACTIVE");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("FASE 2B.2) findActiveConversation() followed by resume() in the same message: 1 findFirst, 0 findUnique", async () => {
    const conv = await createConversationState();
    try {
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);
                enterWithConversationStateRequestCache();

                const active = await EventCreationEngine.findActiveConversation({ channel: "WHATSAPP", channelRef: conv.channelRef });
                const resumed = await EventCreationEngine.resume(active.id);
                timer.finish({ conversationId: conv.id });

                assert.equal(resumed.prompt.stepId, "NAME", "resume() debe ver exactamente el mismo prompt que antes");

                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(countCalls(dbCalls, "conversationState.findFirst"), 1);
                assert.equal(
                    countCalls(dbCalls, "conversationState.findUnique"),
                    0,
                    `resume() no debe volver a leer — dbCalls: ${JSON.stringify(dbCalls)}`
                );
            })
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("FASE 2B.3) findActiveConversation() + resume() + handleInput(): una sola lectura total (findFirst), una sola escritura (updateMany), 0 findUnique", async () => {
    const conv = await createConversationState();
    try {
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);
                enterWithConversationStateRequestCache();

                const active = await EventCreationEngine.findActiveConversation({ channel: "WHATSAPP", channelRef: conv.channelRef });
                await EventCreationEngine.resume(active.id);
                const result = await EventCreationEngine.handleInput(active.id, { value: "Fiesta de Prueba" });
                timer.finish({ conversationId: conv.id });

                assert.equal(result.prompt.stepId, "DESCRIPTION", "la transición real del motor no cambia");

                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(countCalls(dbCalls, "conversationState.findFirst"), 1);
                assert.equal(countCalls(dbCalls, "conversationState.findUnique"), 0);
                assert.equal(countCalls(dbCalls, "conversationState.updateMany"), 1);
            })
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("FASE 2B.4) two concurrent messages (each entering its own cache context, same as processInboundMessages) stay fully isolated", async () => {
    const convA = await createConversationState({ draftEvent: {} });
    const convB = await createConversationState({
        currentStepId: "DESCRIPTION",
        history: ["NAME", "DESCRIPTION"],
        draftEvent: { name: "Evento B" },
    });
    try {
        // Mismo patrón que processInboundMessages (Promise.allSettled sobre
        // varias llamadas a processInboundMessage): cada "mensaje" entra a
        // SU PROPIO contexto (enterWith) antes de cualquier await, así que
        // dos mensajes en simultáneo nunca comparten Map.
        async function simulateMessage(channelRef) {
            enterWithConversationStateRequestCache();
            const active = await EventCreationEngine.findActiveConversation({ channel: "WHATSAPP", channelRef });
            return EventCreationEngine.resume(active.id);
        }

        const [resultA, resultB] = await Promise.all([simulateMessage(convA.channelRef), simulateMessage(convB.channelRef)]);

        assert.equal(resultA.conversationId, convA.id);
        assert.equal(resultA.prompt.stepId, "NAME", "el mensaje A no debe ver nada del contexto de B");
        assert.equal(resultB.conversationId, convB.id);
        assert.equal(resultB.prompt.stepId, "DESCRIPTION", "el mensaje B no debe ver nada del contexto de A");
    } finally {
        await deleteConversationState(convA.id);
        await deleteConversationState(convB.id);
    }
});

testWithDb("FASE 2B.5) an exception in one message's flow never contaminates the next message's fresh cache context", async () => {
    const conv = await createConversationState();
    try {
        // "Mensaje 1": cachea la conversación vía findActiveConversation y
        // termina en una excepción real (otro proceso la cierra en el medio).
        await (async () => {
            enterWithConversationStateRequestCache();
            const active = await EventCreationEngine.findActiveConversation({ channel: "WHATSAPP", channelRef: conv.channelRef });
            assert.ok(active, "el mensaje 1 debe encontrar la conversación activa");
            await prisma.conversationState.update({ where: { id: conv.id }, data: { status: "PUBLISHED" } });
            await assert.rejects(() => EventCreationEngine.handleInput(conv.id, { value: "x" }), /CONVERSATION_CLOSED/);
        })();

        // Se reabre para poder reutilizarla en el "mensaje 2" — no afecta lo
        // que se está probando (el contexto de cache es nuevo, no la
        // conversación en sí).
        await prisma.conversationState.update({ where: { id: conv.id }, data: { status: "ACTIVE" } });

        // "Mensaje 2": contexto de cache COMPLETAMENTE NUEVO, igual que hace
        // processInboundMessage en cada invocación real — no debe heredar
        // nada del mensaje anterior, ni siquiera la excepción.
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);
                enterWithConversationStateRequestCache();

                const active = await EventCreationEngine.findActiveConversation({ channel: "WHATSAPP", channelRef: conv.channelRef });
                const resumed = await EventCreationEngine.resume(conv.id);
                timer.finish({ conversationId: conv.id });

                assert.equal(active.id, conv.id);
                assert.equal(resumed.prompt.stepId, "NAME");

                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(
                    countCalls(dbCalls, "conversationState.findUnique"),
                    0,
                    "el mensaje 2 cachea su propia copia fresca vía findActiveConversation, sin arrastrar nada del mensaje 1"
                );
            })
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("FASE 2B.6) findActiveConversation() returns null (same as before) when there is no active conversation for that channelRef", async () => {
    enterWithConversationStateRequestCache();
    const active = await EventCreationEngine.findActiveConversation({
        channel: "WHATSAPP",
        channelRef: `missing_${randomUUID()}`,
    });
    assert.equal(active, null);
});

testWithDb("FASE 2B.7) a conversation closed by another process right after findActiveConversation cached it is still detected by updateMany, never silently overwritten", async () => {
    const conv = await createConversationState();
    try {
        enterWithConversationStateRequestCache();

        const active = await EventCreationEngine.findActiveConversation({ channel: "WHATSAPP", channelRef: conv.channelRef });
        assert.ok(active);

        // Otro proceso cierra la conversación justo después de cachearla.
        await prisma.conversationState.update({ where: { id: conv.id }, data: { status: "PUBLISHED" } });

        // handleInput todavía tiene la copia vieja (ACTIVE) cacheada desde
        // findActiveConversation, pero la escritura real debe seguir
        // detectando que la fila ya no está ACTIVE.
        await assert.rejects(() => EventCreationEngine.handleInput(conv.id, { value: "x" }), /CONVERSATION_CLOSED/);

        const stored = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(stored.currentStepId, "NAME", "la escritura conflictiva nunca debe haberse aplicado");
        assert.equal(stored.status, "PUBLISHED");
    } finally {
        await deleteConversationState(conv.id);
    }
});
