import test from "node:test";
import assert from "node:assert/strict";
import {
    enterWithConversationStateRequestCache,
    getCachedConversationState,
    setCachedConversationState,
    invalidateCachedConversationState,
} from "../src/conversation/conversationStateRequestCache.js";

// Fase 4 (optimización de latencia) — este módulo nunca toca Prisma (es
// pura infraestructura de AsyncLocalStorage, mismo criterio que
// utils/whatsappPerf.js), así que se prueba directo, sin DB y sin mocks de
// Prisma.

function fakeState(id, extra = {}) {
    return { id, currentStepId: "NAME", draftEvent: {}, history: ["NAME"], status: "ACTIVE", ...extra };
}

test("without an active context (never entered), get/set/invalidate are all safe no-ops — this is exactly the Web path", () => {
    assert.equal(getCachedConversationState("conv1"), null);
    assert.doesNotThrow(() => setCachedConversationState(fakeState("conv1")));
    assert.doesNotThrow(() => invalidateCachedConversationState("conv1"));
    // Nunca crea una Map "de respaldo": seguir sin contexto activo, la
    // lectura sigue devolviendo null.
    assert.equal(getCachedConversationState("conv1"), null);
});

test("within a context, a cached state is returned by id, and never leaks under a different id", async () => {
    await new Promise((resolve) => {
        enterWithConversationStateRequestCache();
        setCachedConversationState(fakeState("conv1", { currentStepId: "DESCRIPTION" }));

        assert.equal(getCachedConversationState("conv1").currentStepId, "DESCRIPTION");
        assert.equal(getCachedConversationState("conv_other"), null, "un id distinto nunca debe pisar/devolver la copia de otro");
        resolve();
    });
});

// Requisito 2 del pedido — "el estado actualizado se reutiliza dentro del
// mismo mensaje": setCachedConversationState vuelve a llamarse tras cada
// escritura real (ver applyConversationUpdate en EventCreationEngine.js) —
// acá se prueba la pieza que hace eso posible: sobrescribir la copia
// cacheada de un id ya presente.
test("setCachedConversationState overwrites the previous copy for the same id, never appends a second one", async () => {
    await new Promise((resolve) => {
        enterWithConversationStateRequestCache();
        setCachedConversationState(fakeState("conv1", { currentStepId: "NAME" }));
        setCachedConversationState(fakeState("conv1", { currentStepId: "CATEGORY", history: ["NAME", "CATEGORY"] }));

        const cached = getCachedConversationState("conv1");
        assert.equal(cached.currentStepId, "CATEGORY");
        assert.deepEqual(cached.history, ["NAME", "CATEGORY"]);
        resolve();
    });
});

test("invalidateCachedConversationState removes only the targeted id, leaving other cached ids untouched", async () => {
    await new Promise((resolve) => {
        enterWithConversationStateRequestCache();
        setCachedConversationState(fakeState("conv1"));
        setCachedConversationState(fakeState("conv2"));

        invalidateCachedConversationState("conv1");

        assert.equal(getCachedConversationState("conv1"), null);
        assert.ok(getCachedConversationState("conv2"), "invalidar conv1 nunca debe afectar a conv2");
        resolve();
    });
});

// ==================================================================
// Requisito 3 — "dos solicitudes concurrentes permanecen aisladas". Mismo
// mecanismo y mismo criterio que el test análogo de whatsappDbPerf.test.js
// para el timer de perf ("two concurrent active timers never leak dbCalls
// into each other"): cada "mensaje" entra a su propio contexto asíncrono,
// Promise.all los corre en paralelo, y ninguno debe ver la copia cacheada
// del otro aunque compartan el mismo conversationId.
// ==================================================================

test("two concurrent contexts (as Promise.allSettled would run them) never leak cached state into each other, even for the same conversationId", async () => {
    async function runOne(currentStepId, delayMs) {
        enterWithConversationStateRequestCache();
        setCachedConversationState(fakeState("conv_shared", { currentStepId }));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        // Si el contexto se hubiera mezclado con el del otro mensaje, acá
        // podríamos estar leyendo el currentStepId que puso el otro.
        return getCachedConversationState("conv_shared")?.currentStepId;
    }

    const [resultA, resultB] = await Promise.all([runOne("NAME", 15), runOne("DESCRIPTION", 5)]);

    assert.equal(resultA, "NAME", "el mensaje A nunca debe ver el estado que cacheó el mensaje B");
    assert.equal(resultB, "DESCRIPTION", "el mensaje B nunca debe ver el estado que cacheó el mensaje A");
});

// ==================================================================
// Requisito 4 — "una excepción no debe contaminar la siguiente solicitud".
// Cada invocación (equivalente a processInboundMessage) entra a un contexto
// NUEVO al principio — un throw a mitad de camino nunca dejó nada en una Map
// compartida (no existe tal cosa), así que la siguiente invocación arranca
// limpia sin importar cómo terminó la anterior.
// ==================================================================

test("an exception thrown mid-message never contaminates the next message's cache", async () => {
    async function processMessageThatThrows() {
        enterWithConversationStateRequestCache();
        setCachedConversationState(fakeState("conv1", { currentStepId: "POISONED" }));
        throw new Error("boom");
    }

    async function processNextMessage() {
        enterWithConversationStateRequestCache();
        // Mensaje nuevo: nunca debería ver "POISONED" del mensaje anterior,
        // aunque use el mismo conversationId (ej. el mismo organizador
        // reintentando después de un error).
        return getCachedConversationState("conv1");
    }

    await assert.rejects(() => processMessageThatThrows(), /boom/);
    const nextCache = await processNextMessage();
    assert.equal(nextCache, null, "el siguiente mensaje debe arrancar con un contexto completamente vacío");
});
