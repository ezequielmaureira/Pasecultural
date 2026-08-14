import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import * as EventCreationEngine from "../src/conversation/EventCreationEngine.js";
import { logger } from "../src/logging/logger.js";
import { startWhatsappPerfTimer, enterWithActiveTimer } from "../src/utils/whatsappPerf.js";
import { enterWithConversationStateRequestCache } from "../src/conversation/conversationStateRequestCache.js";

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
