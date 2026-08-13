import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { WHATSAPP_IMAGE_REQUIRED_TEXT, extractWhatsappReplyText } from "../src/services/whatsappOrganizerBot.service.js";

// Bug fix (imagen esperada en WhatsApp) — cuando el step real vigente es
// COVER_IMAGE (IMAGE_URL) y llega CUALQUIER contenido que no sea una imagen
// válida (texto, video, audio, documento, sticker, ubicación...), el motor
// nunca debe enterarse: ni avanza, ni muta el draft, ni toca
// WhatsappPendingStepInput, ni sube nada a Cloudinary — sólo se le pide al
// organizador que mande una foto. Mismo criterio DI que
// tests/whatsapp.imageUpload.controller.test.js/whatsapp.organizerBot.test.js.

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

const BACK_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", text: "Elegí la categoría de tu evento.", options: [{ id: "MUSICA", label: "Música" }] },
    canGoBack: true,
    sections: [],
};

function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: spy(IMAGE_URL_PROMPT_RESULT),
            handleConversationInput: spy(BACK_RESULT),
            cancelConversation: spy(undefined),
            uploadImage: spy({ success: true, url: "https://res.cloudinary.com/pasecultural/image/upload/v1/pasecultural/abc123.jpg" }),
            findReusableLocation: spy(null),
            resetPendingStepInput: spy(undefined),
            updatePendingStepInputStatus: spy(undefined),
            deletePendingStepInput: spy(undefined),
            getPendingStepInput: spy(null),
            ...overrides,
        },
        sendCalls,
    };
}

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.IN1",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "Hola",
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

function otherMediaMessage(type, overrides = {}) {
    return {
        messageId: "wamid.MEDIA1",
        from: "5491122334455",
        type,
        timestamp: "1700000000",
        text: null,
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

function locationMessage(overrides = {}) {
    return {
        messageId: "wamid.LOC1",
        from: "5491122334455",
        type: "location",
        timestamp: "1700000000",
        text: null,
        location: { latitude: -33.12, longitude: -64.35, name: null, address: null },
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

// ==================================================
// Texto crudo mientras se espera imagen
// ==================================================

// El motor SIGUE recibiendo el texto crudo primero, igual que para
// cualquier otro step (mismo contrato que Web, ver el intento "primero el
// texto crudo" en processInboundMessage) — inputHandlers/imageUrl.js#parse
// es quien realmente decide que "no es una imagen no es válido" (ver el
// test de más abajo que prueba que una URL http(s) válida SÍ sigue
// avanzando). Sólo se traduce la respuesta cuando el motor la rechazó.
const IMAGE_URL_VALIDATION_ERROR_RESULT = {
    conversationId: "conv1",
    prompt: {
        stepId: "COVER_IMAGE",
        type: "QUESTION",
        inputType: "IMAGE_URL",
        error: "Subí la imagen a /api/media/upload y mandame la URL que te devuelve.",
        text: "Mandame la imagen principal de tu evento.",
    },
    canGoBack: true,
    sections: [],
};

test("plain text while awaiting IMAGE_URL asks for a photo instead of the generic Web upload error", async () => {
    const { deps, sendCalls } = baseDeps({ handleConversationInput: spy(IMAGE_URL_VALIDATION_ERROR_RESULT) });

    await processInboundMessage(textMessage({ text: "esto es una descripción larga, no una imagen" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_IMAGE_REQUIRED_TEXT);
    assert.ok(!sendCalls[0].text.includes("/api/media/upload"), "nunca debe filtrarse el error genérico pensado para Web");
    assert.equal(deps.uploadImage.calls.length, 0);
});

test("a syntactically valid http(s) URL as raw text is unaffected by this fix — still reaches the engine and can still advance", async () => {
    const NEXT_STEP_RESULT = {
        conversationId: "conv1",
        prompt: { stepId: "LOCATION", type: "QUESTION", inputType: "LOCATION", text: "¿Dónde es el evento?" },
        canGoBack: true,
        sections: [],
    };
    const { deps, sendCalls } = baseDeps({ handleConversationInput: spy(NEXT_STEP_RESULT) });

    await processInboundMessage(textMessage({ text: "https://res.cloudinary.com/pasecultural/image/upload/v1/abc.jpg" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "https://res.cloudinary.com/pasecultural/image/upload/v1/abc.jpg" }]);
    assert.notEqual(sendCalls[0].text, WHATSAPP_IMAGE_REQUIRED_TEXT);
});

test("the step never advances and nothing else is touched when the engine rejects invalid text on IMAGE_URL", async () => {
    const { deps } = baseDeps({ handleConversationInput: spy(IMAGE_URL_VALIDATION_ERROR_RESULT) });

    await processInboundMessage(textMessage({ text: "no es una imagen" }), deps);

    // El motor recibe UN solo intento con el texto crudo (rechazado, nunca
    // avanza — mismo invariante que cualquier otro step con prompt.error) y
    // el controller nunca reintenta ni toca nada más: ni upload, ni
    // WhatsappPendingStepInput.
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "no es una imagen" }]);
    assert.equal(deps.uploadImage.calls.length, 0);
    assert.equal(deps.resetPendingStepInput.calls.length, 0);
    assert.equal(deps.updatePendingStepInputStatus.calls.length, 0);
});

// ==================================================
// Otros tipos de contenido (video/audio/documento/sticker)
// ==================================================

for (const mediaType of ["video", "audio", "document", "sticker"]) {
    test(`a ${mediaType} message while awaiting IMAGE_URL asks for a photo instead of being silently ignored`, async () => {
        const { deps, sendCalls } = baseDeps({ handleConversationInput: spy(undefined) });

        await processInboundMessage(otherMediaMessage(mediaType), deps);

        assert.equal(sendCalls.length, 1, `antes de este fix un ${mediaType} se ignoraba en silencio`);
        assert.equal(sendCalls[0].text, WHATSAPP_IMAGE_REQUIRED_TEXT);
        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(deps.uploadImage.calls.length, 0);
    });
}

test("a video with no active conversation is still ignored in silence, same as before this fix", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy(null), handleConversationInput: spy(undefined) });

    await processInboundMessage(otherMediaMessage("video"), deps);

    assert.equal(sendCalls.length, 0);
});

test("a video on a step that is NOT IMAGE_URL is still ignored in silence — this fix never touches other steps", async () => {
    const { deps, sendCalls } = baseDeps({
        resumeConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" } }),
        handleConversationInput: spy(undefined),
    });

    await processInboundMessage(otherMediaMessage("video"), deps);

    assert.equal(sendCalls.length, 0);
});

// ==================================================
// Ubicación mientras se espera imagen
// ==================================================

test("a location message while awaiting IMAGE_URL asks for a photo, not the generic 'no necesito ubicación' text", async () => {
    const { deps, sendCalls } = baseDeps({ handleConversationInput: spy(undefined) });

    await processInboundMessage(locationMessage(), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_IMAGE_REQUIRED_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// ==================================================
// Imagen válida — comportamiento preservado
// ==================================================

test("a valid image on IMAGE_URL still uploads and advances the engine normally (unaffected by this fix)", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "LOCATION", type: "QUESTION", inputType: "LOCATION", text: "Elegí la ubicación." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(
        {
            messageId: "wamid.IMG1",
            from: "5491122334455",
            type: "image",
            timestamp: "1700000000",
            text: null,
            image: { id: "media-1", mimeType: "image/jpeg", sha256: "abc123", caption: null },
            profileName: "Elvis Bar",
            phoneNumberId: "PHONE_ID_1",
        },
        deps
    );

    assert.equal(deps.uploadImage.calls.length, 1);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.notEqual(sendCalls[0].text, WHATSAPP_IMAGE_REQUIRED_TEXT);
});

// ==================================================
// "Volver" sigue funcionando en COVER_IMAGE
// ==================================================

test("'Volver' while awaiting IMAGE_URL still triggers the global BACK handling instead of the new image-required text", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "Volver" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(sendCalls[0].text, extractWhatsappReplyText(BACK_RESULT));
    assert.notEqual(sendCalls[0].text, WHATSAPP_IMAGE_REQUIRED_TEXT);
});
