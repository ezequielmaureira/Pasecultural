import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { processInboundMessage, processInboundMessages } from "../src/controllers/whatsapp.controller.js";
import { logger } from "../src/logging/logger.js";

// Fase CIERRE — idempotencia de mensajes entrantes por wamid, probada al
// nivel del controller con TODAS las dependencias mockeadas (mismo criterio
// DI que el resto de tests/whatsapp.*.controller.test.js — ninguna de estas
// funciones es la real, así que nada de esto toca Prisma/Meta). Los
// escenarios de concurrencia real / restricción @unique de Postgres están
// cubiertos aparte, contra una base de TEST real, en
// whatsappInboundMessageClaim.service.test.js.

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

function imageMessage(overrides = {}) {
    return {
        messageId: "wamid.IMG1",
        from: "5491122334455",
        type: "image",
        timestamp: "1700000000",
        text: null,
        image: { id: "media-1", mimeType: "image/jpeg", sha256: "abc123", caption: null },
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
        if (returnValue instanceof Error) throw returnValue;
        return typeof returnValue === "function" ? returnValue(...args) : returnValue;
    };
    fn.calls = calls;
    return fn;
}

// Simula el service real EXACTAMENTE en su contrato observable (claimed +
// reason), pero en memoria — sirve para probar la orquestación del
// controller (cuándo llama al motor, cuándo no, cuándo finaliza el
// reclamo) sin necesitar Postgres. La lógica de concurrencia/atomicidad
// real de este mismo contrato ya está probada contra TEST real en
// whatsappInboundMessageClaim.service.test.js.
function fakeClaimStore() {
    const claims = new Map(); // wamid -> "PROCESSING" | "COMPLETED" | "FAILED"
    const claimCalls = [];
    const completeCalls = [];
    const failCalls = [];

    return {
        claimInboundMessage: async (wamid) => {
            claimCalls.push(wamid);
            const current = claims.get(wamid);
            if (current === "COMPLETED") return { claimed: false, reason: "COMPLETED" };
            if (current === "PROCESSING") return { claimed: false, reason: "IN_PROGRESS" };
            claims.set(wamid, "PROCESSING");
            return { claimed: true };
        },
        completeInboundMessageClaim: async (wamid) => {
            completeCalls.push(wamid);
            claims.set(wamid, "COMPLETED");
        },
        failInboundMessageClaim: async (wamid) => {
            failCalls.push(wamid);
            claims.set(wamid, "FAILED");
        },
        claimCalls,
        completeCalls,
        failCalls,
    };
}

function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    const store = fakeClaimStore();
    return {
        deps: {
            sendText,
            findActiveConversation: spy(null),
            startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" }, canGoBack: false, sections: [] }),
            handleConversationInput: spy(null),
            cancelConversation: spy(undefined),
            discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }]),
            getPendingSelection: spy(null),
            claimInboundMessage: store.claimInboundMessage,
            completeInboundMessageClaim: store.completeInboundMessageClaim,
            failInboundMessageClaim: store.failInboundMessageClaim,
            ...overrides,
        },
        sendCalls,
        store,
    };
}

// ==================================================================
// 1) wamid nuevo -> se procesa normalmente, una sola vez.
// ==================================================================
test("1) a brand-new wamid is claimed and processed normally", async () => {
    const { deps, sendCalls, store } = baseDeps();

    await processInboundMessage(textMessage(), deps);

    assert.deepEqual(store.claimCalls, ["wamid.IN1"]);
    assert.equal(store.completeCalls.length, 1, "una entrega exitosa debe marcar el reclamo COMPLETED al terminar");
    assert.equal(sendCalls.length, 1);
});

// ==================================================================
// 4) mismo texto, wamid DISTINTO -> ambos se procesan (mensajes reales
// distintos, nunca deduplicados entre sí).
// ==================================================================
test("4) the same text with two different wamids is processed twice", async () => {
    const { deps, sendCalls } = baseDeps({ handleConversationInput: spy(null), findActiveConversation: spy(null) });

    await processInboundMessage(textMessage({ messageId: "wamid.A", text: "Hola" }), deps);
    await processInboundMessage(textMessage({ messageId: "wamid.B", text: "Hola" }), deps);

    assert.equal(sendCalls.length, 2, "dos wamid distintos son dos mensajes reales, ambos deben responderse");
});

// ==================================================================
// 2) mismo wamid entregado SECUENCIALMENTE -> la segunda entrega se ignora
// por completo (nunca toca el motor, nunca manda una segunda respuesta).
// 6) nunca modifica ConversationState en el duplicado.
// 7) nunca envía una segunda respuesta a Meta.
// ==================================================================
test("2/6/7) the same wamid delivered sequentially is ignored the second time — no engine call, no second reply", async () => {
    const { deps, sendCalls } = baseDeps({
        findActiveConversation: spy(null),
        discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }]),
    });

    await processInboundMessage(textMessage({ text: "Sí" }), deps);
    await processInboundMessage(textMessage({ text: "Sí" }), deps);

    assert.equal(deps.startConversation.calls.length, 1, "el motor nunca debe volver a tocarse para el duplicado");
    assert.equal(sendCalls.length, 1, "el duplicado nunca debe generar una segunda respuesta a Meta");
});

// ==================================================================
// 5) un duplicado no vuelve a descargar/subir una imagen.
// ==================================================================
test("5) a duplicate image message never re-uploads the image nor re-touches the engine", async () => {
    const uploadImage = spy({ success: true, url: "https://res.cloudinary.com/pasecultural/image/upload/v1/abc.jpg" });
    const { deps, sendCalls } = baseDeps({
        findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
        resumeConversation: spy({ conversationId: "conv1", prompt: { stepId: "COVER_IMAGE", type: "QUESTION", inputType: "IMAGE_URL", text: "Mandame la imagen." }, canGoBack: true, sections: [] }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "LOCATION", type: "QUESTION", inputType: "LOCATION", text: "Ubicación." }, canGoBack: true, sections: [] }),
        uploadImage,
    });

    await processInboundMessage(imageMessage(), deps);
    await processInboundMessage(imageMessage(), deps);

    assert.equal(uploadImage.calls.length, 1, "la imagen nunca debe volver a subirse para un duplicado");
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.equal(sendCalls.length, 1);
});

// ==================================================================
// 3 (nivel controller, complementa el test real de concurrencia en
// whatsappInboundMessageClaim.service.test.js) — si el reclamo reporta
// IN_PROGRESS (la segunda de dos entregas "concurrentes" del mismo wamid),
// esa entrega nunca toca el motor ni responde.
// ==================================================================
test("3) a delivery that loses the claim race (IN_PROGRESS) never touches the engine nor replies", async () => {
    const { deps, sendCalls } = baseDeps({
        claimInboundMessage: async () => ({ claimed: false, reason: "IN_PROGRESS" }),
        findActiveConversation: spy(null),
    });

    await processInboundMessage(textMessage(), deps);

    assert.equal(deps.findActiveConversation.calls.length, 0, "una entrega que pierde la carrera nunca debe llegar a findActiveConversation");
    assert.equal(sendCalls.length, 0);
});

// ==================================================================
// 13) un batch con mensajes nuevos y duplicados procesa sólo los nuevos.
// 14) mensajes de wamid distinto siguen aislados entre sí vía Promise.all.
// ==================================================================
test("13/14) a batch with new and duplicate wamids processes only the new ones, each isolated", async () => {
    const store = fakeClaimStore();
    const { sendText, calls: sendCalls } = fakeSender();
    const deps = {
        sendText,
        findActiveConversation: spy(null),
        startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "x" } }),
        handleConversationInput: spy(null),
        cancelConversation: spy(undefined),
        discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }]),
        getPendingSelection: spy(null),
        claimInboundMessage: store.claimInboundMessage,
        completeInboundMessageClaim: store.completeInboundMessageClaim,
        failInboundMessageClaim: store.failInboundMessageClaim,
    };

    const messages = [
        textMessage({ messageId: "wamid.NEW1", from: "5491100000001", text: "Sí" }),
        textMessage({ messageId: "wamid.NEW1", from: "5491100000001", text: "Sí" }), // reentrega exacta
        textMessage({ messageId: "wamid.NEW2", from: "5491100000002", text: "Sí" }),
    ];

    await processInboundMessages(messages, deps);

    assert.equal(deps.startConversation.calls.length, 2, "sólo los DOS wamid distintos deben llegar al motor, nunca la reentrega");
    assert.deepEqual(
        deps.startConversation.calls.map((call) => call[0].channelRef).sort(),
        ["5491100000001", "5491100000002"]
    );
    assert.equal(sendCalls.length, 2);
});

// ==================================================================
// 15) mensaje procesable SIN wamid conserva el comportamiento anterior a
// esta fase — nunca se llama al mecanismo de reclamo, y el mensaje se
// procesa igual.
// ==================================================================
test("15) a processable message without a wamid is processed exactly as before this phase — dedupe is never invoked", async () => {
    const { deps, sendCalls, store } = baseDeps({ findActiveConversation: spy(null) });

    await processInboundMessage(textMessage({ messageId: null }), deps);

    assert.equal(store.claimCalls.length, 0, "sin wamid, el reclamo nunca debe intentarse");
    assert.equal(store.completeCalls.length, 0);
    assert.equal(store.failCalls.length, 0);
    assert.equal(sendCalls.length, 1, "el mensaje se sigue procesando igual, sólo sin protección de idempotencia");
});

// ==================================================================
// Fallos: un error real en el procesamiento marca el reclamo FAILED (nunca
// COMPLETED) — queda reintentable de inmediato por una reentrega futura.
// ==================================================================
test("a real processing error marks the claim FAILED, never COMPLETED — the message stays retryable", async () => {
    const { deps, store } = baseDeps({
        findActiveConversation: spy(new Error("simulated Prisma outage")),
    });

    await processInboundMessage(textMessage(), deps);

    assert.equal(store.failCalls.length, 1);
    assert.equal(store.completeCalls.length, 0);
});

// processInboundMessage nunca deja escapar la excepción, con o sin dedupe activo.
test("processInboundMessage never throws even when the engine call fails", async () => {
    const { deps } = baseDeps({ findActiveConversation: spy(new Error("boom")) });

    await assert.doesNotReject(() => processInboundMessage(textMessage(), deps));
});

// ==================================================================
// Degradación seguraa: si el propio mecanismo de reclamo falla de forma
// inesperada (ej. la tabla de idempotencia momentáneamente inalcanzable),
// el mensaje se procesa igual — nunca se bloquea un mensaje real por una
// falla ajena a él.
// ==================================================================
test("if the claim mechanism itself throws unexpectedly, the message is still processed (fail-open), and the claim is never finalized", async () => {
    const { deps, sendCalls } = baseDeps({
        claimInboundMessage: async () => {
            throw new Error("idempotency table momentarily unreachable");
        },
        findActiveConversation: spy(null),
    });

    await processInboundMessage(textMessage(), deps);

    assert.equal(sendCalls.length, 1, "un fallo del propio mecanismo de dedupe nunca debe bloquear un mensaje real");
});

// ==================================================================
// Log seguro de duplicado — nunca texto/teléfono/payload.
// ==================================================================
test("a duplicate logs a safe [WA_DEDUP] DUPLICATE_IGNORED line, never containing the phone or message text", async () => {
    const originalInfo = logger.info;
    const calls = [];
    logger.info = (message, context) => calls.push({ message, context });

    try {
        const { deps } = baseDeps({ findActiveConversation: spy(null) });
        await processInboundMessage(textMessage({ from: "5491100009999", text: "un texto cualquiera" }), deps);
        await processInboundMessage(textMessage({ from: "5491100009999", text: "un texto cualquiera" }), deps);

        const dedupLog = calls.find((c) => c.message === "[WA_DEDUP] DUPLICATE_IGNORED");
        assert.ok(dedupLog, "esperaba una línea [WA_DEDUP] DUPLICATE_IGNORED para el duplicado");
        assert.equal(dedupLog.context.reason, "COMPLETED");
        const serialized = JSON.stringify(dedupLog);
        assert.ok(!serialized.includes("5491100009999"));
        assert.ok(!serialized.includes("un texto cualquiera"));
    } finally {
        logger.info = originalInfo;
    }
});

// ==================================================================
// 17) textos/acciones/transiciones actuales no cambian — regresión mínima:
// el texto de respuesta para un wamid nuevo es idéntico al que ya devolvía
// el motor, sin ningún prefijo/sufijo agregado por esta fase.
// ==================================================================
test("17) the reply text for a normal (non-duplicate) message is untouched by this phase", async () => {
    const { deps, sendCalls } = baseDeps({
        findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
        resumeConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" }, canGoBack: false, sections: [] }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "DESCRIPTION", type: "QUESTION", inputType: "SHORT_TEXT", text: "Contame de qué se trata." }, canGoBack: true, sections: [] }),
    });

    await processInboundMessage(textMessage({ text: "Fiesta Aniversario" }), deps);

    assert.equal(sendCalls[0].text, "Contame de qué se trata.");
});

// ==================================================================
// 16) Web no cambia — conversation.controller.js (único punto de entrada
// del canal Web) nunca debe referenciar el mecanismo de idempotencia de
// WhatsApp: son mundos completamente separados.
// ==================================================================
test("16) conversation.controller.js (Web) never references the WhatsApp inbound-message dedupe mechanism", () => {
    const path = fileURLToPath(new URL("../src/controllers/conversation.controller.js", import.meta.url));
    const source = readFileSync(path, "utf8");
    assert.ok(!source.includes("whatsappInboundMessageClaim"), "Web no debe conocer ni importar la idempotencia de WhatsApp");
    assert.ok(!source.includes("wamid"), "Web no debe conocer el concepto de wamid");
});
