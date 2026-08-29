import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_LOCATION_METHOD_PROMPT_TEXT,
    WHATSAPP_LOCATION_METHOD_INVALID_TEXT,
    WHATSAPP_LOCATION_SHARE_PROMPT_TEXT,
    WHATSAPP_LOCATION_SHARE_RETRY_TEXT,
    WHATSAPP_LOCATION_MANUAL_ADDRESS_PROMPT_TEXT,
    WHATSAPP_LOCATION_NOT_EXPECTED_TEXT,
    WHATSAPP_LOCATION_INSUFFICIENT_TEXT,
    isPublishableWhatsappLocation,
    buildWhatsappCompactAddressInvalidText,
    buildWhatsappLocationConfirmationText,
    buildWhatsappLocationReusePromptText,
    buildWhatsappLocationReuseInvalidText,
    buildWhatsappGoogleMapsLink,
    WHATSAPP_LOCATION_COMMIT_ERROR_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// ==================================================
// isPublishableWhatsappLocation — pura, sin cambios en esta fase. assertPublishable
// (event.service.js) exige EXACTAMENTE venueName + (formattedAddress|addressLine);
// con la fórmula real de EventServicePort#buildLocationInput (venueName cae a
// address si falta name), el único campo verdaderamente indispensable es
// `address`. Nunca exige city/province.
// ==================================================

test("isPublishableWhatsappLocation: a searched place (name+address) is publishable", () => {
    assert.equal(isPublishableWhatsappLocation({ latitude: -31.4, longitude: -64.18, name: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" }), true);
});

test("isPublishableWhatsappLocation: a live pin (no name, no address) is NOT publishable", () => {
    assert.equal(isPublishableWhatsappLocation({ latitude: -31.4, longitude: -64.18 }), false);
});

// Fase 3K — ubicación conversacional: 1) elegir método (compartir/manual),
// 2A) compartir ubicación nativa, 2B) dirección completa en UN mensaje
// compacto ("San Martín 850, General Roca, Río Negro"). Mismo criterio DI
// que el resto del proyecto: todas las dependencias reales (Prisma/
// EventCreationEngine) se inyectan como mocks.

function createFakePendingStore(seed = null) {
    const rows = new Map();
    if (seed) rows.set(seed.conversationId, { ...seed });

    const calls = { get: [], reset: [], update: [], delete: [] };

    return {
        calls,
        getPendingStepInput: async (conversationId) => {
            calls.get.push(conversationId);
            return rows.get(conversationId) ?? null;
        },
        resetPendingStepInput: async (conversationId, stepId, status, partialData = {}) => {
            calls.reset.push({ conversationId, stepId, status, partialData });
            const row = { id: `pending_${conversationId}`, conversationId, stepId, status, partialData };
            rows.set(conversationId, row);
            return row;
        },
        updatePendingStepInputStatus: async (conversationId, status, partialData) => {
            calls.update.push({ conversationId, status, partialData });
            const existing = rows.get(conversationId);
            const updated = { ...existing, status, partialData };
            rows.set(conversationId, updated);
            return updated;
        },
        deletePendingStepInput: async (conversationId) => {
            calls.delete.push(conversationId);
            rows.delete(conversationId);
        },
    };
}

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.TXT1",
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

const LOCATION_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "LOCATION", type: "QUESTION", inputType: "LOCATION", text: "¿Dónde es el evento?" },
    canGoBack: true,
    sections: [],
};

const CATEGORY_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", text: "Elegí la categoría de tu evento.", options: [{ id: "MUSICA", label: "Música" }] },
    canGoBack: true,
    sections: [],
};

const NEXT_STEP_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Este evento ocurre una sola vez o se repite?", options: [] },
    canGoBack: true,
    sections: [],
};

function baseDeps({ pendingStore, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    const store = pendingStore ?? createFakePendingStore();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }),
            resumeConversation: spy(LOCATION_STEP_STATE),
            handleConversationInput: spy(NEXT_STEP_RESULT),
            cancelConversation: spy(undefined),
            getPendingStepInput: store.getPendingStepInput,
            resetPendingStepInput: store.resetPendingStepInput,
            updatePendingStepInputStatus: store.updatePendingStepInputStatus,
            deletePendingStepInput: store.deletePendingStepInput,
            findReusableLocation: spy(null),
            // Premium — Fase 2C. Este archivo prueba el sub-flujo de
            // ubicación, no el feature gate — por default PREMIUM preserva
            // el comportamiento histórico.
            getOrganizationPlanForWhatsapp: spy({ plan: "PREMIUM" }),
            ...overrides,
        },
        sendCalls,
        store,
    };
}

// ==================================================
// 1) al entrar muestra selector 1/2 (primer aterrizaje al step, vía
// extractWhatsappReplyText — no pasa por el pending todavía).
// ==================================================

test("landing on LOCATION for the first time shows the method selector (1. Compartir / 2. Manual)", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "COVER_IMAGE", type: "QUESTION", inputType: "IMAGE_URL", text: "Mandame la imagen." },
            canGoBack: true,
            sections: [],
        }),
        handleConversationInput: spy(LOCATION_STEP_STATE),
    });

    await processInboundMessage(textMessage({ text: "https://res.cloudinary.com/x.jpg" }), deps);

    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
    assert.ok(sendCalls[0].text.startsWith("📍 ¿Cómo querés cargar la ubicación del evento?\n\n1. Compartir ubicación\n2. Completar dirección manualmente\n\nRespondé con 1 o 2."));
    assert.equal(store.calls.reset.length, 0);
});

// ==================================================
// 2) "1" → espera ubicación compartida
// ==================================================

test("replying '1' at the method selector moves to AWAITING_LOCATION_SHARE", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], { conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_METHOD", partialData: {} });
    assert.equal(store.calls.update.length, 1);
    assert.equal(store.calls.update[0].status, "AWAITING_LOCATION_SHARE");
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_SHARE_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// ==================================================
// 3) "2" → espera la dirección completa en un solo mensaje
// ==================================================

test("replying '2' at the method selector moves to AWAITING_MANUAL_ADDRESS", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_MANUAL_ADDRESS");
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_MANUAL_ADDRESS_PROMPT_TEXT);
});

// 11) opción 3 → no avanza
test("an invalid method choice (3) never advances, re-shows the selector", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "3" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_INVALID_TEXT);
});

// ==================================================
// Fase 3K — dirección manual compacta, un solo mensaje.
// ==================================================

test("a well-formed compact address builds the location and asks for confirmation, WITHOUT calling the engine yet", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_MANUAL_ADDRESS", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "San Martín 850, Río Cuarto, Córdoba" }), deps);

    const expectedLocation = {
        address: "San Martín 850",
        city: "Río Cuarto",
        province: "Córdoba",
        venueName: null,
        latitude: null,
        longitude: null,
        googlePlaceId: null,
    };
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor no se llama todavía, falta confirmar");
    assert.equal(store.calls.update[0].status, "AWAITING_LOCATION_CONFIRMATION");
    assert.deepEqual(store.calls.update[0].partialData, { location: expectedLocation });
    assert.equal(sendCalls[0].text, buildWhatsappLocationConfirmationText(expectedLocation));
});

test("a malformed compact address (missing province) never advances, explains the comma-separated format", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_MANUAL_ADDRESS", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "San Martín 850, Río Cuarto" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(store.calls.update.length, 0);
    assert.equal(sendCalls[0].text, buildWhatsappCompactAddressInvalidText());
});

test("a compact address with an unrecognized province never advances, never invents a province", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_MANUAL_ADDRESS", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "San Martín 850, Río Cuarto, Neverland" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, buildWhatsappCompactAddressInvalidText());
});

test("'volver' from AWAITING_MANUAL_ADDRESS returns to the method selector (single level, no partial sub-steps)", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_MANUAL_ADDRESS", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], { conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_METHOD", partialData: {} });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

// ==================================================
// 9) ubicación compartida válida → motor exactamente una vez
// 10) ubicación insuficiente → no motor
// ==================================================

test("a valid shared location (AWAITING_LOCATION_SHARE) builds the location and asks for confirmation, WITHOUT calling the engine yet", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_SHARE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(locationMessage(), deps);

    const expectedLocation = { latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" };
    assert.equal(deps.handleConversationInput.calls.length, 0, "el motor no se llama todavía, falta confirmar");
    assert.equal(store.calls.update[0].status, "AWAITING_LOCATION_CONFIRMATION");
    assert.deepEqual(store.calls.update[0].partialData, { location: expectedLocation });
    assert.equal(sendCalls[0].text, buildWhatsappLocationConfirmationText(expectedLocation));
});

test("an insufficient shared location (pin, no address) never reaches the engine and stays AWAITING_LOCATION_SHARE", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_SHARE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(locationMessage({ location: { latitude: -34.6, longitude: -58.38 } }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(store.calls.delete.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_INSUFFICIENT_TEXT);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.equal(stillPending.status, "AWAITING_LOCATION_SHARE");
});

test("free text while AWAITING_LOCATION_SHARE never advances, asks to share again", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_SHARE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "San Martín 123" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_SHARE_RETRY_TEXT);
    assert.ok(!sendCalls[0].text.includes("San Martín 123"));
});

// ==================================================
// VOLVER
// ==================================================

test("esperando ubicación compartida → volver → selector de método", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_SHARE", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.equal(store.calls.reset[0].status, "AWAITING_LOCATION_METHOD");
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
});

// Sección 9 — primer sub-paso (AWAITING_LOCATION_METHOD) + volver: BACK
// real del motor, auditado y seguro (currentStepId sigue siendo LOCATION
// durante todo este sub-flujo).
test("volver from AWAITING_LOCATION_METHOD (first sub-step) uses the engine's real BACK and deletes the pending", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_METHOD", partialData: {} });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "COVER_IMAGE", type: "QUESTION", inputType: "IMAGE_URL", text: "Mandame la imagen." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(store.calls.delete.length, 1);
    assert.equal(sendCalls[0].text, "Mandame la imagen.");
});

test("if the engine rejects BACK from AWAITING_LOCATION_METHOD, the pending is not deleted", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_METHOD", partialData: {} });
    const { deps } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "LOCATION", type: "QUESTION", text: "x", error: "Ya estás en la primera pregunta." },
            canGoBack: false,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.delete.length, 0);
});

// ==================================================
// message.type === "location" fuera del step LOCATION / sin conversación
// ==================================================

test("a shared location while the engine expects a different step is never processed as a location", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store, resumeConversation: spy(CATEGORY_STEP_STATE) });

    await processInboundMessage(locationMessage(), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.startsWith(WHATSAPP_LOCATION_NOT_EXPECTED_TEXT));
    assert.ok(sendCalls[0].text.includes("Elegí la categoría de tu evento."));
});

test("a shared location with no active conversation is silently ignored", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store, findActiveConversation: spy(null) });

    await processInboundMessage(locationMessage(), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

test("a malformed location message without real coordinates is ignored entirely", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(locationMessage({ location: null }), deps);

    assert.equal(deps.findActiveConversation.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

// ==================================================
// Reinicio entre webhooks — el sub-flujo completo, partido en llamadas
// independientes que sólo comparten el store (Postgres real en producción).
// ==================================================

test("the manual sub-flow survives independent processInboundMessage calls, no in-memory dependency", async () => {
    const store = createFakePendingStore();

    const { deps: deps1, sendCalls: sendCalls1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "2" }), deps1);
    assert.equal(sendCalls1[0].text, WHATSAPP_LOCATION_MANUAL_ADDRESS_PROMPT_TEXT);

    const expectedLocation = {
        address: "San Martín 850",
        city: "Río Cuarto",
        province: "Córdoba",
        venueName: null,
        latitude: null,
        longitude: null,
        googlePlaceId: null,
    };

    const { deps: deps2, sendCalls: sendCalls2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "San Martín 850, Río Cuarto, Córdoba" }), deps2);
    assert.equal(deps2.handleConversationInput.calls.length, 0, "todavía falta confirmar");
    assert.equal(sendCalls2[0].text, buildWhatsappLocationConfirmationText(expectedLocation));

    const { deps: deps3, sendCalls: sendCalls3 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "1" }), deps3);
    assert.equal(deps3.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps3.handleConversationInput.calls[0][1].value, expectedLocation);
    assert.equal(sendCalls3[0].text, "¿Este evento ocurre una sola vez o se repite?");
    assert.equal(await store.getPendingStepInput("conv1"), null);
});

// ==================================================
// Fase 3G, sección 4 — confirmación de ubicación (AWAITING_LOCATION_CONFIRMATION).
// ==================================================

test("AWAITING_LOCATION_CONFIRMATION: '1' (share path) calls the engine exactly once with the exact object already built, then deletes the pending", async () => {
    const location = { latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_CONFIRMATION", partialData: { location } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: location }]);
    assert.equal(store.calls.delete.length, 1);
    assert.equal(sendCalls[0].text, "¿Este evento ocurre una sola vez o se repite?");
});

test("AWAITING_LOCATION_CONFIRMATION: 'Sí' (manual path) calls the engine exactly once with the exact object already built", async () => {
    const location = { address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", venueName: null, latitude: null, longitude: null, googlePlaceId: null };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_CONFIRMATION", partialData: { location } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "sí" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: location }]);
    assert.equal(sendCalls[0].text, "¿Este evento ocurre una sola vez o se repite?");
});

test("AWAITING_LOCATION_CONFIRMATION: '2'/'No' discards the temporary location and returns to the method selector, never calling the engine", async () => {
    const location = { latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_CONFIRMATION", partialData: { location } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], { conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_METHOD", partialData: {} });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
});

test("AWAITING_LOCATION_CONFIRMATION: 'volver' also discards the temporary location and returns to the method selector", async () => {
    const location = { address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", venueName: null, latitude: null, longitude: null, googlePlaceId: null };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_CONFIRMATION", partialData: { location } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "VOLVER" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(store.calls.reset[0].status, "AWAITING_LOCATION_METHOD");
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
});

test("AWAITING_LOCATION_CONFIRMATION: an invalid reply never advances and re-shows the same confirmation", async () => {
    const location = { latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_CONFIRMATION", partialData: { location } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "tal vez" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(store.calls.update.length, 0);
    assert.equal(store.calls.reset.length, 0);
    assert.equal(sendCalls[0].text, buildWhatsappLocationConfirmationText(location));
});

test("AWAITING_LOCATION_CONFIRMATION: if the engine rejects the confirmed location, the pending is NOT deleted and stays recoverable", async () => {
    const location = { latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_CONFIRMATION", partialData: { location } });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "LOCATION", type: "QUESTION", inputType: "LOCATION", text: "x", error: "algo inesperado" } }),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(store.calls.delete.length, 0);
    const stillPending = await store.getPendingStepInput("conv1");
    assert.equal(stillPending.status, "AWAITING_LOCATION_CONFIRMATION");
    assert.deepEqual(stillPending.partialData, { location });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_COMMIT_ERROR_TEXT);
});

// ==================================================
// Fase 3K, sección 9 — reutilizar la ubicación del último evento de la
// Organization (AWAITING_REUSE_CONFIRMATION). El pending ya viene creado
// (lo arma replyForEngineResult, whatsapp.controller.js, en el momento en
// que el motor recién avanza a LOCATION — ver whatsapp.imageUpload.controller.test.js
// para esa parte); acá se prueba sólo la respuesta a esa pregunta.
// ==================================================

test("AWAITING_REUSE_CONFIRMATION: '1' commits the reused location directly, without asking method/address again", async () => {
    const reusable = { venueName: "Elvis Bar", address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", latitude: null, longitude: null, googlePlaceId: null };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_REUSE_CONFIRMATION", partialData: { location: reusable } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: reusable }]);
    assert.equal(store.calls.delete.length, 1);
    assert.equal(sendCalls[0].text, "¿Este evento ocurre una sola vez o se repite?");
});

test("AWAITING_REUSE_CONFIRMATION: '2' (es en otro lugar) falls through to the normal method selector, never calling the engine", async () => {
    const reusable = { venueName: "Elvis Bar", address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", latitude: null, longitude: null, googlePlaceId: null };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_REUSE_CONFIRMATION", partialData: { location: reusable } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(store.calls.update[0].status, "AWAITING_LOCATION_METHOD");
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
});

test("AWAITING_REUSE_CONFIRMATION: an invalid reply re-shows the same reuse question, never guesses", async () => {
    const reusable = { venueName: "Elvis Bar", address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", latitude: null, longitude: null, googlePlaceId: null };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_REUSE_CONFIRMATION", partialData: { location: reusable } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "tal vez" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, buildWhatsappLocationReuseInvalidText(reusable));
});

test("AWAITING_REUSE_CONFIRMATION: 'volver' uses the engine's real BACK, same as the method selector", async () => {
    const reusable = { venueName: "Elvis Bar", address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", latitude: null, longitude: null, googlePlaceId: null };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_REUSE_CONFIRMATION", partialData: { location: reusable } });
    const { deps, sendCalls } = baseDeps({
        pendingStore: store,
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "COVER_IMAGE", type: "QUESTION", inputType: "IMAGE_URL", text: "Mandame la imagen." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.equal(store.calls.delete.length, 1);
    assert.equal(sendCalls[0].text, "Mandame la imagen.");
});

test("buildWhatsappLocationReusePromptText mentions the venue name and the address", () => {
    const text = buildWhatsappLocationReusePromptText({ venueName: "Elvis Bar", address: "San Martín 850", city: "Río Cuarto" });
    assert.ok(text.includes("Elvis Bar"));
    assert.ok(text.includes("San Martín 850"));
    assert.ok(text.includes("1. Sí"));
    assert.ok(text.includes("2. Es en otro lugar"));
});

// ==================================================
// Fase 3G, sección 4 — link de Google Maps: coordenadas vs. dirección.
// ==================================================

test("buildWhatsappGoogleMapsLink: coordinates produce a standard maps link by lat/lng, never geocoding", () => {
    const link = buildWhatsappGoogleMapsLink({ latitude: -31.4201, longitude: -64.1888 });
    assert.equal(link, "https://www.google.com/maps/search/?api=1&query=-31.4201,-64.1888");
});

test("buildWhatsappGoogleMapsLink: no coordinates but an address produces a URL-encoded search link", () => {
    const link = buildWhatsappGoogleMapsLink({ address: "San Martín 850", city: "Río Cuarto", province: "Córdoba" });
    assert.equal(link, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("San Martín 850, Río Cuarto, Córdoba")}`);
});

test("buildWhatsappGoogleMapsLink: neither coordinates nor address returns null, never a broken link", () => {
    assert.equal(buildWhatsappGoogleMapsLink({}), null);
    assert.equal(buildWhatsappGoogleMapsLink(null), null);
});

test("buildWhatsappLocationConfirmationText includes the maps link and the 1/2 + VOLVER instructions", () => {
    const text = buildWhatsappLocationConfirmationText({ latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" });
    assert.ok(text.startsWith("📍 Esta es la ubicación que tengo:"));
    assert.ok(text.includes("Teatro del Libertador"));
    assert.ok(text.includes("🗺️ Ver en Google Maps:"));
    assert.ok(text.includes("https://www.google.com/maps/search/?api=1&query=-31.4201,-64.1888"));
    assert.ok(text.includes("1. Sí\n2. No"));
    assert.ok(text.includes("VOLVER"));
});

// ==================================================
// Cross-subflow: un pending viejo de LOCATION nunca se reutiliza si el
// step real vigente ya no es LOCATION (ej. la conversación avanzó a
// FUNCTIONS_SINGLE_CARD sin que el pending se haya limpiado por algún
// motivo) — el stepId real (resumeConversation) es la fuente de verdad,
// nunca el stepId grabado en el pending por sí solo.
// ==================================================

test("a stale LOCATION pending is never reused when the real current step has moved on", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_MANUAL_ADDRESS", partialData: {} });
    const { deps } = baseDeps({
        pendingStore: store,
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "FUNCTIONS_SINGLE_CARD", type: "QUESTION", inputType: "FUNCTION_CARD", text: "Contame cuándo es la función." },
            canGoBack: true,
            sections: [],
        }),
    });

    await processInboundMessage(textMessage({ text: "algo" }), deps);

    // No se interpretó como respuesta de dirección del sub-flujo LOCATION.
    assert.equal(store.calls.update.length, 0);
});
