import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import { WHATSAPP_VIDEO_NOT_EXPECTED_TEXT, WHATSAPP_VIDEO_REQUIRED_TEXT, WHATSAPP_IMAGE_REQUIRED_TEXT, buildWhatsappVideoUploadErrorText } from "../src/services/whatsappOrganizerBot.service.js";

// Fest Pass — árbol de decisión de processInboundMessage para
// message.type==="video". Mismo criterio DI/estilo exacto que
// whatsapp.imageUpload.controller.test.js (imagen): todas las dependencias
// reales (Prisma/EventCreationEngine/Meta/Cloudinary) se inyectan como mocks.

function videoMessage(overrides = {}) {
    return {
        messageId: "wamid.VID1",
        from: "5491122334455",
        type: "video",
        timestamp: "1700000000",
        text: null,
        video: { id: "media-1", mimeType: "video/mp4", sha256: "abc123", caption: null },
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

const VIDEO_UPLOAD_PROMPT_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "FEST_PASS_VIDEO_UPLOAD", type: "QUESTION", inputType: "VIDEO_UPLOAD", text: "Mandame el video que querés usar como fondo de tu Fest Pass." },
    canGoBack: true,
    sections: [],
};

const COVER_IMAGE_PROMPT_RESULT = {
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
            resumeConversation: spy(VIDEO_UPLOAD_PROMPT_RESULT),
            handleConversationInput: spy({
                conversationId: "conv1",
                prompt: { stepId: "SOCIAL_LINKS_ASK", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar redes sociales?" },
                canGoBack: true,
                sections: [],
            }),
            cancelConversation: spy(undefined),
            uploadVideo: spy({ success: true, url: "https://res.cloudinary.com/pasecultural/video/upload/v1/pasecultural/abc123.mp4", publicId: "pasecultural/abc123", duration: 12 }),
            getOrganizationPlanForWhatsapp: spy({ plan: "PREMIUM" }),
            ...overrides,
        },
        sendCalls,
    };
}

test("a valid video on the VIDEO_UPLOAD step uploads it and advances the engine with {url, publicId}", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(videoMessage(), deps);

    assert.equal(deps.uploadVideo.calls.length, 1);
    assert.deepEqual(deps.uploadVideo.calls[0], ["media-1"]);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], [
        "conv1",
        { value: { url: "https://res.cloudinary.com/pasecultural/video/upload/v1/pasecultural/abc123.mp4", publicId: "pasecultural/abc123" } },
    ]);
    assert.ok(sendCalls[0].text.startsWith("¿Querés agregar redes sociales?"));
});

test("a video with no active conversation is silently ignored, same pattern as image", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy(null) });

    await processInboundMessage(videoMessage(), deps);

    assert.equal(deps.resumeConversation.calls.length, 0);
    assert.equal(deps.uploadVideo.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

test("a video on a step that is not VIDEO_UPLOAD is never uploaded and never sent to the engine", async () => {
    const { deps, sendCalls } = baseDeps({ resumeConversation: spy(NAME_PROMPT_RESULT) });

    await processInboundMessage(videoMessage(), deps);

    assert.equal(deps.uploadVideo.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.startsWith(WHATSAPP_VIDEO_NOT_EXPECTED_TEXT));
});

test("a video sent while the engine is waiting for COVER_IMAGE asks for a PHOTO, not a video", async () => {
    const { deps, sendCalls } = baseDeps({ resumeConversation: spy(COVER_IMAGE_PROMPT_RESULT) });

    await processInboundMessage(videoMessage(), deps);

    assert.equal(deps.uploadVideo.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_IMAGE_REQUIRED_TEXT);
});

for (const reason of ["INVALID_MIME_TYPE", "FILE_TOO_LARGE", "META_METADATA_ERROR", "META_DOWNLOAD_ERROR", "CLOUDINARY_ERROR", "VIDEO_TOO_LONG"]) {
    test(`an upload failure (${reason}) never advances the engine and replies with a clear, retryable error`, async () => {
        const { deps, sendCalls } = baseDeps({ uploadVideo: spy({ success: false, reason }) });

        await processInboundMessage(videoMessage(), deps);

        assert.equal(deps.handleConversationInput.calls.length, 0, "el motor no debe avanzar ante un error de video");
        assert.equal(sendCalls[0].text, buildWhatsappVideoUploadErrorText(reason));
    });
}

test("text sent while waiting for VIDEO_UPLOAD never advances and asks for a video (ConversationState stays put)", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { ...VIDEO_UPLOAD_PROMPT_RESULT.prompt, error: "Mandame un video para continuar." },
            canGoBack: true,
            sections: [],
        }),
    });
    const textMessage = { messageId: "wamid.T1", from: "5491122334455", type: "text", timestamp: "1700000000", text: "hola", image: null, video: null, location: null, profileName: "Elvis Bar", phoneNumberId: "PHONE_ID_1" };

    await processInboundMessage(textMessage, deps);

    // El texto SÍ llega al motor (mismo camino genérico de texto), pero el
    // handler VIDEO_UPLOAD lo rechaza — nunca avanza a otro step.
    assert.ok(sendCalls[0].text.includes("Mandame un video para continuar."));
});

test("an image sent while waiting for VIDEO_UPLOAD is never uploaded as a video and never advances the engine (the existing image-not-expected path re-shows the current VIDEO_UPLOAD prompt)", async () => {
    const { deps, sendCalls } = baseDeps({ resumeConversation: spy(VIDEO_UPLOAD_PROMPT_RESULT) });
    const imageMsg = { messageId: "wamid.IMG1", from: "5491122334455", type: "image", timestamp: "1700000000", text: null, image: { id: "media-2", mimeType: "image/jpeg", sha256: "x", caption: null }, video: null, profileName: "Elvis Bar", phoneNumberId: "PHONE_ID_1" };

    await processInboundMessage(imageMsg, deps);

    assert.equal(deps.uploadVideo.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.includes("Mandame el video que querés usar como fondo de tu Fest Pass."));
});

test("a location sent while waiting for VIDEO_UPLOAD never advances and asks for a video", async () => {
    const { deps, sendCalls } = baseDeps({ resumeConversation: spy(VIDEO_UPLOAD_PROMPT_RESULT) });
    const locationMsg = {
        messageId: "wamid.LOC1",
        from: "5491122334455",
        type: "location",
        timestamp: "1700000000",
        text: null,
        location: { latitude: -34.6, longitude: -58.4, name: null, address: null },
        video: null,
        image: null,
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
    };

    await processInboundMessage(locationMsg, deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_VIDEO_REQUIRED_TEXT);
});

test("a document/sticker/etc sent while waiting for VIDEO_UPLOAD never advances and asks for a video", async () => {
    const { deps, sendCalls } = baseDeps({ resumeConversation: spy(VIDEO_UPLOAD_PROMPT_RESULT) });
    const docMsg = { messageId: "wamid.DOC1", from: "5491122334455", type: "document", timestamp: "1700000000", text: null, video: null, image: null, location: null, profileName: "Elvis Bar", phoneNumberId: "PHONE_ID_1" };

    await processInboundMessage(docMsg, deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_VIDEO_REQUIRED_TEXT);
});

test("Premium gate still applies to video uploads (organization without WHATSAPP_EVENT_CREATION never gets its video uploaded)", async () => {
    const { deps, sendCalls } = baseDeps({ getOrganizationPlanForWhatsapp: spy({ plan: "FREE" }) });

    await processInboundMessage(videoMessage(), deps);

    assert.equal(deps.uploadVideo.calls.length, 0, "nunca debe subirse el video sin pasar el gate Premium");
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls.length >= 1);
});

test("a malformed video message without a real media id is treated as 'other media' (same historical bucket as before Fest Pass), never uploaded", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(videoMessage({ video: null }), deps);

    assert.equal(deps.uploadVideo.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_VIDEO_REQUIRED_TEXT);
});

test("no video-upload-failure reply text ever contains a raw error reason", async () => {
    for (const reason of ["INVALID_MIME_TYPE", "FILE_TOO_LARGE", "META_METADATA_ERROR", "META_DOWNLOAD_ERROR", "CLOUDINARY_ERROR", "VIDEO_TOO_LONG", "SOME_UNKNOWN_REASON"]) {
        const { deps, sendCalls } = baseDeps({ uploadVideo: spy({ success: false, reason }) });
        await processInboundMessage(videoMessage(), deps);
        assert.ok(!sendCalls[0].text.includes(reason), `el texto no debería filtrar el reason crudo "${reason}"`);
    }
});
