import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_LOCATION_METHOD_PROMPT_TEXT,
    WHATSAPP_LOCATION_METHOD_INVALID_TEXT,
    WHATSAPP_LOCATION_SHARE_PROMPT_TEXT,
    WHATSAPP_LOCATION_SHARE_RETRY_TEXT,
    WHATSAPP_LOCATION_STREET_PROMPT_TEXT,
    WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT,
    WHATSAPP_LOCATION_STREET_NUMBER_INVALID_TEXT,
    WHATSAPP_LOCATION_CITY_PROMPT_TEXT,
    WHATSAPP_LOCATION_NOT_EXPECTED_TEXT,
    WHATSAPP_LOCATION_INSUFFICIENT_TEXT,
    isPublishableWhatsappLocation,
    buildLocationProvincePromptText,
    buildLocationProvinceInvalidText,
    buildWhatsappLocationConfirmationText,
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

// Fase 3D — ubicación conversacional: 1) elegir método (compartir/manual),
// 2A) compartir ubicación nativa, 2B) calle → altura → ciudad → provincia.
// Mismo criterio DI que el resto del proyecto: todas las dependencias
// reales (Prisma/EventCreationEngine) se inyectan como mocks. El estado
// temporal (WhatsappPendingStepInput) se simula con un store en memoria del
// propio test, igual que en whatsapp.functionCard.controller.test.js.

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
    prompt: { stepId: "FUNCTIONS_MODE", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se realizarán las funciones de este evento?" },
    canGoBack: true,
    sections: [],
};

function baseDeps({ pendingStore, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    const store = pendingStore ?? createFakePendingStore();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: spy(LOCATION_STEP_STATE),
            handleConversationInput: spy(NEXT_STEP_RESULT),
            cancelConversation: spy(undefined),
            getPendingStepInput: store.getPendingStepInput,
            resetPendingStepInput: store.resetPendingStepInput,
            updatePendingStepInputStatus: store.updatePendingStepInputStatus,
            deletePendingStepInput: store.deletePendingStepInput,
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
// 3) "2" → espera calle
// ==================================================

test("replying '2' at the method selector moves to AWAITING_STREET", async () => {
    const store = createFakePendingStore();
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_STREET");
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_STREET_PROMPT_TEXT);
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
// 4) calle válida → altura
// ==================================================

test("a valid street advances to AWAITING_STREET_NUMBER", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "San Martín" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_STREET_NUMBER");
    assert.deepEqual(store.calls.update[0].partialData, { street: "San Martín" });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT);
});

// No hay un test end-to-end para "calle vacía": shouldAutoReply (gate de
// entrada de processInboundMessage) ya exige `text.trim().length > 0` para
// CUALQUIER mensaje de texto — así que un mensaje que resulte vacío
// después de trim() nunca llega a esta rama (queda filtrado antes). La
// validación de calle no vacía en WHATSAPP_LOCATION_STREET_INVALID_TEXT
// queda como defensa adicional, coherente con el resto del archivo, pero
// no es alcanzable a través del pipeline real — no se fuerza un test
// artificial para eso.

// ==================================================
// 5) altura válida → ciudad / 12) altura inválida → no avanza
// ==================================================

test("a valid street number advances to AWAITING_CITY", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET_NUMBER", partialData: { street: "San Martín" } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "850" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_CITY");
    assert.deepEqual(store.calls.update[0].partialData, { street: "San Martín", streetNumber: "850" });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_CITY_PROMPT_TEXT);
});

test("an invalid street number (abc) never advances", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET_NUMBER", partialData: { street: "San Martín" } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "abc" }), deps);

    assert.equal(store.calls.update.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_STREET_NUMBER_INVALID_TEXT);
});

// ==================================================
// 6) ciudad válida → provincia
// ==================================================

test("a valid city advances to AWAITING_PROVINCE and shows the numbered province selector", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "LOCATION",
        status: "AWAITING_CITY",
        partialData: { street: "San Martín", streetNumber: "850" },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "Río Cuarto" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_PROVINCE");
    assert.deepEqual(store.calls.update[0].partialData, { street: "San Martín", streetNumber: "850", city: "Río Cuarto" });
    assert.equal(sendCalls[0].text, buildLocationProvincePromptText());
});

// Mismo motivo que arriba: "ciudad vacía" nunca llega a esta rama a través
// del pipeline real (shouldAutoReply ya la filtra).

// ==================================================
// 7/8) provincia válida → motor llamado exactamente una vez, shape correcto
// 13) provincia fuera de rango → no avanza
// ==================================================

// Fase 3G, sección 4 — una provincia válida ya NO llama al motor
// directamente: arma el objeto y pide confirmación primero.
test("a valid province builds the location and asks for confirmation, WITHOUT calling the engine yet", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "LOCATION",
        status: "AWAITING_PROVINCE",
        partialData: { street: "San Martín", streetNumber: "850", city: "Río Cuarto" },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "5" }), deps); // 5 = Córdoba

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

test("an out-of-range province index never advances", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "LOCATION",
        status: "AWAITING_PROVINCE",
        partialData: { street: "San Martín", streetNumber: "850", city: "Río Cuarto" },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "99" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, buildLocationProvinceInvalidText());
});

// ==================================================
// 9) ubicación compartida válida → motor exactamente una vez
// 10) ubicación insuficiente → no motor
// ==================================================

// Fase 3G, sección 4 — una ubicación compartida válida ya NO llama al motor
// directamente: arma el objeto y pide confirmación primero.
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
// VOLVER — sub-pasos de dirección manual
// ==================================================

test("14) altura → volver → calle (elimina street)", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET_NUMBER", partialData: { street: "San Martín" } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_STREET");
    assert.deepEqual(store.calls.update[0].partialData, {});
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_STREET_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test("15) ciudad → volver → altura (mantiene street, elimina streetNumber)", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_CITY", partialData: { street: "San Martín", streetNumber: "850" } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "VOLVER" }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_STREET_NUMBER");
    assert.deepEqual(store.calls.update[0].partialData, { street: "San Martín" });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT);
});

test("16) provincia → volver → ciudad (mantiene street/streetNumber, elimina city)", async () => {
    const store = createFakePendingStore({
        conversationId: "conv1",
        stepId: "LOCATION",
        status: "AWAITING_PROVINCE",
        partialData: { street: "San Martín", streetNumber: "850", city: "Río Cuarto" },
    });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: " volver " }), deps);

    assert.equal(store.calls.update[0].status, "AWAITING_CITY");
    assert.deepEqual(store.calls.update[0].partialData, { street: "San Martín", streetNumber: "850" });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_CITY_PROMPT_TEXT);
});

test("17) calle → volver → selector de método (reset completo)", async () => {
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET", partialData: {} });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.equal(store.calls.reset.length, 1);
    assert.deepEqual(store.calls.reset[0], { conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_METHOD", partialData: {} });
    assert.equal(sendCalls[0].text, WHATSAPP_LOCATION_METHOD_PROMPT_TEXT);
    assert.equal(deps.handleConversationInput.calls.length, 0);
});

test("18) esperando ubicación compartida → volver → selector de método", async () => {
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

test("26) the manual sub-flow survives independent processInboundMessage calls, no in-memory dependency", async () => {
    const store = createFakePendingStore();

    const { deps: deps1, sendCalls: sendCalls1 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "2" }), deps1);
    assert.equal(sendCalls1[0].text, WHATSAPP_LOCATION_STREET_PROMPT_TEXT);

    const { deps: deps2, sendCalls: sendCalls2 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "San Martín" }), deps2);
    assert.equal(sendCalls2[0].text, WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT);

    const { deps: deps3, sendCalls: sendCalls3 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "850" }), deps3);
    assert.equal(sendCalls3[0].text, WHATSAPP_LOCATION_CITY_PROMPT_TEXT);

    const { deps: deps4, sendCalls: sendCalls4 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "Río Cuarto" }), deps4);
    assert.equal(sendCalls4[0].text, buildLocationProvincePromptText());

    const expectedLocation = {
        address: "San Martín 850",
        city: "Río Cuarto",
        province: "Córdoba",
        venueName: null,
        latitude: null,
        longitude: null,
        googlePlaceId: null,
    };

    const { deps: deps5, sendCalls: sendCalls5 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "5" }), deps5);
    assert.equal(deps5.handleConversationInput.calls.length, 0, "todavía falta confirmar");
    assert.equal(sendCalls5[0].text, buildWhatsappLocationConfirmationText(expectedLocation));

    const { deps: deps6, sendCalls: sendCalls6 } = baseDeps({ pendingStore: store });
    await processInboundMessage(textMessage({ text: "1" }), deps6);
    assert.equal(deps6.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps6.handleConversationInput.calls[0][1].value, expectedLocation);
    assert.equal(sendCalls6[0].text, "¿Cómo se realizarán las funciones de este evento?");
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
    assert.equal(sendCalls[0].text, "¿Cómo se realizarán las funciones de este evento?");
});

test("AWAITING_LOCATION_CONFIRMATION: 'Sí' (manual path) calls the engine exactly once with the exact object already built", async () => {
    const location = { address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", venueName: null, latitude: null, longitude: null, googlePlaceId: null };
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_LOCATION_CONFIRMATION", partialData: { location } });
    const { deps, sendCalls } = baseDeps({ pendingStore: store });

    await processInboundMessage(textMessage({ text: "sí" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: location }]);
    assert.equal(sendCalls[0].text, "¿Cómo se realizarán las funciones de este evento?");
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
    const store = createFakePendingStore({ conversationId: "conv1", stepId: "LOCATION", status: "AWAITING_STREET", partialData: { street: "Colón" } });
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

    // No se interpretó como respuesta de "calle" del sub-flujo LOCATION.
    assert.equal(store.calls.update.length, 0);
});
