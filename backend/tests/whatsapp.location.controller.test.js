import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_LOCATION_PROMPT_TEXT,
    WHATSAPP_LOCATION_RETRY_TEXT,
    WHATSAPP_LOCATION_NOT_EXPECTED_TEXT,
    WHATSAPP_LOCATION_INSUFFICIENT_TEXT,
    isPublishableWhatsappLocation,
} from "../src/services/whatsappOrganizerBot.service.js";

// ==================================================
// isPublishableWhatsappLocation — pura. assertPublishable (event.service.js)
// exige EXACTAMENTE venueName + (formattedAddress|addressLine); con la
// fórmula real de EventServicePort#buildLocationInput (venueName cae a
// address si falta name), el único campo verdaderamente indispensable es
// `address`. Nunca exige city/province (assertPublishable no las pide).
// ==================================================

test("isPublishableWhatsappLocation: a searched place (name+address) is publishable", () => {
    assert.equal(isPublishableWhatsappLocation({ latitude: -31.4, longitude: -64.18, name: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" }), true);
});

test("isPublishableWhatsappLocation: address alone (no name) is publishable — venueName falls back to it downstream", () => {
    assert.equal(isPublishableWhatsappLocation({ latitude: -31.4, longitude: -64.18, address: "Av. Vélez Sarsfield 365" }), true);
});

test("isPublishableWhatsappLocation: a live pin (no name, no address) is NOT publishable", () => {
    assert.equal(isPublishableWhatsappLocation({ latitude: -31.4, longitude: -64.18 }), false);
});

test("isPublishableWhatsappLocation: name alone (no address) is NOT publishable — formattedAddress/addressLine would stay empty", () => {
    assert.equal(isPublishableWhatsappLocation({ latitude: -31.4, longitude: -64.18, name: "Algún lugar" }), false);
});

test("isPublishableWhatsappLocation: an address that is only whitespace is NOT publishable", () => {
    assert.equal(isPublishableWhatsappLocation({ latitude: -31.4, longitude: -64.18, address: "   " }), false);
});

test("isPublishableWhatsappLocation: never throws on null/undefined input", () => {
    assert.equal(isPublishableWhatsappLocation(null), false);
    assert.equal(isPublishableWhatsappLocation(undefined), false);
});

// Bug fix (ubicación exclusivamente por WhatsApp Location) — árbol de
// decisión de processInboundMessage para message.type==="location" y para
// texto libre durante el step LOCATION. Mismo criterio DI que
// tests/whatsapp.imageUpload.controller.test.js: todas las dependencias
// reales (Prisma/EventCreationEngine) se inyectan como mocks.

function locationMessage(overrides = {}) {
    return {
        messageId: "wamid.LOC1",
        from: "5491122334455",
        type: "location",
        timestamp: "1700000000",
        text: null,
        location: { latitude: -31.4201, longitude: -64.1888, name: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" },
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.TXT1",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "San Martín 123",
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

const LOCATION_PROMPT_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "LOCATION", type: "QUESTION", inputType: "LOCATION", text: "¿Dónde es el evento? Necesito dirección, ciudad y provincia." },
    canGoBack: true,
    sections: [],
};

const CATEGORY_PROMPT_RESULT = {
    conversationId: "conv1",
    prompt: {
        stepId: "CATEGORY",
        type: "QUESTION",
        inputType: "SINGLE_SELECT",
        text: "Elegí la categoría de tu evento.",
        options: [{ id: "MUSICA", label: "Música" }],
    },
    canGoBack: true,
    sections: [],
};

function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: spy(LOCATION_PROMPT_RESULT),
            handleConversationInput: spy({
                conversationId: "conv1",
                prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Cómo se realizarán las funciones de este evento?", options: [{ id: "SINGLE", label: "Una sola función" }] },
                canGoBack: true,
                sections: [],
            }),
            cancelConversation: spy(undefined),
            uploadImage: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

// ==================================================
// message.type === "location" durante el step correcto (LOCATION)
// ==================================================

test("a valid shared location on the LOCATION step is transformed and advances the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(locationMessage(), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], [
        "conv1",
        { value: { latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" } },
    ]);
    assert.ok(sendCalls[0].text.includes("Una sola función"));
});

test("a valid shared location never invents city or province", async () => {
    const { deps } = baseDeps();

    await processInboundMessage(locationMessage(), deps);

    const [, { value }] = deps.handleConversationInput.calls[0];
    assert.ok(!("city" in value));
    assert.ok(!("province" in value));
});

test("the engine is called exactly once for a single valid location", async () => {
    const { deps } = baseDeps();
    await processInboundMessage(locationMessage(), deps);
    assert.equal(deps.handleConversationInput.calls.length, 1);
});

// ==================================================
// Pre-validación de "publicabilidad" — un pin/ubicación actual (sin
// `address`) nunca va a poder publicarse después (assertPublishable exige
// venueName + dirección; venueName cae a `address` si falta `name`, ver
// EventServicePort#buildLocationInput) — se rechaza ANTES de guardar nada
// en el draft ni de tocar el motor, no recién al intentar publicar.
// ==================================================

test("a live-pin location (no name, no address) is rejected before ever reaching the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(locationMessage({ location: { latitude: -34.6, longitude: -58.38 } }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0, "una ubicación insuficiente nunca debe llegar a handleInput");
    assert.equal(sendCalls[0].text, "📍 Necesito la ubicación del lugar del evento.\n\nTocá 📎 → Ubicación, buscá el nombre del lugar y seleccioná el establecimiento.\n\nNo envíes solamente tu ubicación actual.");
});

test("a location with only a name but no address is also rejected (formattedAddress/addressLine would still be empty)", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(locationMessage({ location: { latitude: -34.6, longitude: -58.38, name: "Algún lugar" } }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.includes("No envíes solamente tu ubicación actual."));
});

test("a location with only an address (no name) is accepted — venueName falls back to address downstream", async () => {
    const { deps } = baseDeps();

    await processInboundMessage(locationMessage({ location: { latitude: -34.6, longitude: -58.38, address: "Av. Siempre Viva 742" } }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0][1], {
        value: { latitude: -34.6, longitude: -58.38, venueName: null, address: "Av. Siempre Viva 742" },
    });
});

test("an insufficient location leaves the conversation exactly where it was — no state-mutating call happens", async () => {
    const { deps } = baseDeps();

    await processInboundMessage(locationMessage({ location: { latitude: -34.6, longitude: -58.38 } }), deps);

    // resume() (lectura pura) es la única consulta permitida; nunca se
    // llama a cancelConversation/startConversation/handleConversationInput
    // — ninguna de ellas muta ConversationState para este mensaje.
    assert.equal(deps.resumeConversation.calls.length, 1);
    assert.equal(deps.cancelConversation.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// ==================================================
// message.type === "location" fuera del step LOCATION
// ==================================================

test("a shared location while the engine expects a different step (ej. CATEGORY) is never processed as a location", async () => {
    const { deps, sendCalls } = baseDeps({ resumeConversation: spy(CATEGORY_PROMPT_RESULT) });

    await processInboundMessage(locationMessage(), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.startsWith(WHATSAPP_LOCATION_NOT_EXPECTED_TEXT));
    assert.ok(sendCalls[0].text.includes("Elegí la categoría de tu evento."));
    assert.ok(sendCalls[0].text.includes("1. Música"));
});

test("a shared location with no active conversation is silently ignored", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy(null) });

    await processInboundMessage(locationMessage(), deps);

    assert.equal(deps.resumeConversation.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

test("a malformed location message without real coordinates is ignored entirely, exactly like an unsupported message type", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(locationMessage({ location: null }), deps);

    assert.equal(deps.findActiveConversation.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

// ==================================================
// Texto libre durante el step LOCATION — nunca se usa como dirección, nunca
// se geocodifica, nunca avanza el motor.
// ==================================================

test("free text during the LOCATION step never advances the engine and asks to share the location again", async () => {
    const { deps, sendCalls } = baseDeps({
        // El motor rechaza el string (no es un objeto válido, ver
        // inputHandlers/location.js) y vuelve a mostrar el mismo prompt con error.
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { ...LOCATION_PROMPT_RESULT.prompt, error: "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "San Martín 123" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "San Martín 123" }]);
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_RETRY_TEXT);
    assert.ok(!sendCalls[0].text.includes("San Martín 123"), "el texto escrito nunca debe reaparecer en la respuesta");
});

test("the WhatsApp-specific location prompt is shown (not the engine's generic Web text) when the engine advances into the LOCATION step", async () => {
    const { deps, sendCalls } = baseDeps({
        findActiveConversation: spy(null),
        getPendingSelection: spy(null),
        discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }]),
        startConversation: spy(LOCATION_PROMPT_RESULT),
    });

    await processInboundMessage(textMessage({ text: "Sí" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_PROMPT_TEXT);
    assert.ok(!sendCalls[0].text.includes("Necesito dirección, ciudad y provincia"));
});
