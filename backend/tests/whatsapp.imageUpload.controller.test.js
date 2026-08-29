import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_IMAGE_NOT_EXPECTED_TEXT,
    buildWhatsappImageUploadErrorText,
    WHATSAPP_LOCATION_METHOD_PROMPT_TEXT,
    WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Bug fix (carga de imagen del evento) — árbol de decisión de
// processInboundMessage para message.type==="image". Mismo criterio DI que
// tests/whatsapp.organizerBot.test.js: todas las dependencias reales
// (Prisma/EventCreationEngine/Meta/Cloudinary) se inyectan como mocks.

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

const IMAGE_URL_PROMPT_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "COVER_IMAGE", type: "QUESTION", inputType: "IMAGE_URL", text: "Mandame la imagen principal de tu evento." },
    canGoBack: true,
    sections: [],
};

const NAME_PROMPT_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" },
    canGoBack: false,
    sections: [],
};

function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }),
            resumeConversation: spy(IMAGE_URL_PROMPT_RESULT),
            // El step real después de COVER_IMAGE es LOCATION, pero acá se
            // simula un step neutro a propósito: el renderizado específico
            // de LOCATION para WhatsApp tiene su propia cobertura dedicada
            // (ver tests/whatsapp.location.controller.test.js) — este
            // archivo sólo prueba el flujo de IMAGEN, sin acoplarse a eso.
            handleConversationInput: spy({
                conversationId: "conv1",
                prompt: { stepId: "SOME_NEXT_STEP", type: "QUESTION", inputType: "SHORT_TEXT", text: "Siguiente pregunta del motor." },
                canGoBack: true,
                sections: [],
            }),
            cancelConversation: spy(undefined),
            uploadImage: spy({ success: true, url: "https://res.cloudinary.com/pasecultural/image/upload/v1/pasecultural/abc123.jpg" }),
            resetPendingStepInput: spy(undefined),
            // Premium — Fase 2C. Este archivo no prueba el feature gate —
            // por default PREMIUM preserva el comportamiento histórico.
            getOrganizationPlanForWhatsapp: spy({ plan: "PREMIUM" }),
            ...overrides,
        },
        sendCalls,
    };
}

const LOCATION_PROMPT_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "LOCATION", type: "QUESTION", inputType: "LOCATION", text: "Elegí la ubicación del evento." },
    canGoBack: true,
    sections: [],
};

const REUSABLE_LOCATION = {
    venueName: "Elvis Bar",
    address: "San Martín 850",
    city: "Río Cuarto",
    province: "Córdoba",
    latitude: -33.12,
    longitude: -64.35,
    googlePlaceId: "place_123",
};

// ==================================================
// Fix (dejar de sugerir direcciones de eventos anteriores) — al confirmar
// la imagen de portada, el motor avanza a LOCATION y ANTES se ofrecía
// reutilizar la última dirección usable de la Organization (Event.findFirst,
// ver whatsappOrganizationLocation.service.js). Ahora se va SIEMPRE directo
// al selector de método (extractWhatsappReplyText ya lo arma solo para
// cualquier resultado con step LOCATION, sin ninguna consulta ni dato
// precargado) — ver el comentario en whatsapp.controller.js.
// ==================================================

test("after the image is confirmed and the engine advances to LOCATION, the two-option method selector is shown directly — no reusable-location lookup, no previous address in the text", async () => {
    const { deps, sendCalls } = baseDeps({
        findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }),
        handleConversationInput: spy(LOCATION_PROMPT_RESULT),
        // Se pasa a propósito: si el controller todavía la llamara, este spy
        // lo detectaría. El fix elimina la dependencia del todo —
        // processInboundMessage ya ni siquiera la destructura, así que
        // queda como una propiedad extra sin uso, nunca invocada.
        findReusableLocation: spy(REUSABLE_LOCATION),
    });

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.findReusableLocation.calls.length, 0, "Event.findFirst para direcciones anteriores no debe ejecutarse en el flujo nuevo");
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
    assert.ok(sendCalls[0].text.includes("1. Compartir ubicación"));
    assert.ok(sendCalls[0].text.includes("2. Completar dirección manualmente"));
    assert.ok(!sendCalls[0].text.includes(REUSABLE_LOCATION.address), "ninguna dirección anterior debe aparecer en el mensaje");
    assert.ok(!sendCalls[0].text.includes(REUSABLE_LOCATION.venueName), "ningún nombre de lugar anterior debe aparecer en el mensaje");
});

test("the state starts empty: no pending is pre-created (nor pre-filled) when landing on LOCATION right after the image", async () => {
    const { deps } = baseDeps({
        findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }),
        handleConversationInput: spy(LOCATION_PROMPT_RESULT),
    });

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.resetPendingStepInput.calls.length, 0, "el pending se sigue creando recién con el próximo mensaje (tryHandleLocationSubflow), nunca acá con datos precargados");
});

// Premium — Fase 2C. Hasta antes de esta fase, organizationId era
// irrelevante para este renderizado puntual (por eso el test original
// comparaba "con y sin organizationId" y esperaba el MISMO selector de
// ubicación en ambos casos — ver el commit anterior a Fase 2C). Eso ya no
// es válido a propósito: toda ConversationState de WHATSAPP recibe
// organizationId obligatorio desde EventCreationEngine.start (resuelto
// ANTES por el choke point 1 de Fase 2C, ver whatsapp.controller.js) — que
// una conversación activa llegue SIN organizationId es una anomalía que
// nunca debería ocurrir en producción, y el comportamiento correcto es
// fail-safe: nunca se asume PREMIUM, nunca se sube la imagen, nunca se
// avanza el motor. Nunca se inventa un organizationId acá — el test sigue
// verificando exactamente el caso corrupto/incompleto, sólo que ahora la
// expectativa correcta es que se bloquee, no que se ignore.
test("an active conversation without organizationId is an unresolved-Organization anomaly — fail-safe: the image is never uploaded, the engine never advances", async () => {
    const { deps, sendCalls } = baseDeps({
        findActiveConversation: spy({ id: "conv1", userId: "user_123" }), // sin organizationId, a propósito
        handleConversationInput: spy(LOCATION_PROMPT_RESULT),
        findReusableLocation: spy(REUSABLE_LOCATION),
    });

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.uploadImage.calls.length, 0, "nunca debe subirse la imagen sin poder confirmar la Organization");
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor nunca debe avanzar sin poder confirmar la Organization");
    assert.equal(deps.findReusableLocation.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT, "debe responder el mensaje seguro de Organization no encontrada, nunca el selector de ubicación");
});

test("no pending is created when the engine advances to a step other than LOCATION", async () => {
    const { deps } = baseDeps({
        findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "SOME_NEXT_STEP", type: "QUESTION", inputType: "SHORT_TEXT", text: "Siguiente pregunta del motor." } }),
    });

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.resetPendingStepInput.calls.length, 0);
});

test("a valid image on the IMAGE_URL step uploads it and advances the engine with the Cloudinary secure_url", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.uploadImage.calls.length, 1);
    assert.deepEqual(deps.uploadImage.calls[0], ["media-1"]);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "https://res.cloudinary.com/pasecultural/image/upload/v1/pasecultural/abc123.jpg" }]);
    assert.equal(sendCalls[0].text, "Siguiente pregunta del motor.");
});

test("an image on a step that is not IMAGE_URL is never uploaded and never sent to the engine", async () => {
    const { deps, sendCalls } = baseDeps({ resumeConversation: spy(NAME_PROMPT_RESULT) });

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.uploadImage.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.startsWith(WHATSAPP_IMAGE_NOT_EXPECTED_TEXT));
    assert.ok(sendCalls[0].text.includes("¿Cómo se llama tu evento?"));
});

test("an image with no active conversation is silently ignored, same as before this fix", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy(null) });

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.resumeConversation.calls.length, 0);
    assert.equal(deps.uploadImage.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

test("a malformed image message without a real media id is ignored entirely, exactly like an unsupported message type", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(imageMessage({ image: null }), deps);

    assert.equal(deps.findActiveConversation.calls.length, 0);
    assert.equal(deps.uploadImage.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

for (const reason of ["INVALID_MIME_TYPE", "FILE_TOO_LARGE", "META_METADATA_ERROR", "META_DOWNLOAD_ERROR", "CLOUDINARY_ERROR"]) {
    test(`a Meta/Cloudinary upload failure (${reason}) never advances the engine and replies with a clear, retryable error`, async () => {
        const { deps, sendCalls } = baseDeps({ uploadImage: spy({ success: false, reason }) });

        await processInboundMessage(imageMessage(), deps);

        assert.equal(deps.handleConversationInput.calls.length, 0, "el motor no debe avanzar ante un error de imagen");
        assert.equal(sendCalls[0].text, buildWhatsappImageUploadErrorText(reason));
    });
}

test("the engine is never called twice for a single valid image", async () => {
    const { deps } = baseDeps();

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
});

test("resume() is used to inspect the current step without mutating it — never calls startConversation/cancelConversation for an image", async () => {
    const { deps } = baseDeps();

    await processInboundMessage(imageMessage(), deps);

    assert.equal(deps.cancelConversation.calls.length, 0);
    assert.equal(deps.resumeConversation.calls.length, 1);
    assert.deepEqual(deps.resumeConversation.calls[0], ["conv1"]);
});

test("no upload-failure reply text ever contains a raw error reason or token-shaped value", async () => {
    for (const reason of ["INVALID_MIME_TYPE", "FILE_TOO_LARGE", "META_METADATA_ERROR", "META_DOWNLOAD_ERROR", "CLOUDINARY_ERROR", "SOME_UNKNOWN_REASON"]) {
        const { deps, sendCalls } = baseDeps({ uploadImage: spy({ success: false, reason }) });
        await processInboundMessage(imageMessage(), deps);
        assert.ok(!sendCalls[0].text.includes(reason), `el texto no debería filtrar el reason crudo "${reason}"`);
        assert.ok(!/bearer/i.test(sendCalls[0].text));
    }
});
