import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoReply, AUTO_REPLY_TEXT } from "../src/services/whatsapp.service.js";
import {
    processInboundMessage,
    processInboundMessages,
    receiveWhatsappWebhook,
} from "../src/controllers/whatsapp.controller.js";

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

function fakeSender(result) {
    const calls = [];
    const sendText = async (args) => {
        calls.push(args);
        if (result instanceof Error) throw result;
        return result;
    };
    return { sendText, calls };
}

// ==================================================
// shouldAutoReply — pura
// ==================================================

test("shouldAutoReply is true for a valid non-empty text message", () => {
    assert.equal(shouldAutoReply(textMessage()), true);
});

// F) text null -> no responde.
test("shouldAutoReply is false when text is null", () => {
    assert.equal(shouldAutoReply(textMessage({ text: null })), false);
});

// G) text vacío / sólo espacios -> no responde.
test("shouldAutoReply is false when text is empty or whitespace-only", () => {
    assert.equal(shouldAutoReply(textMessage({ text: "" })), false);
    assert.equal(shouldAutoReply(textMessage({ text: "   " })), false);
});

// E) mensaje no-text (ej. image, ya con text:null por el parser) -> no responde.
test("shouldAutoReply is false for a non-text message type", () => {
    assert.equal(shouldAutoReply(textMessage({ type: "image", text: null })), false);
});

test("shouldAutoReply is false when from is missing", () => {
    assert.equal(shouldAutoReply(textMessage({ from: null })), false);
});

// ==================================================
// processInboundMessage — con sendText inyectado (sin red real)
// ==================================================

// A) mensaje text válido -> llama exactamente una vez a sendText.
test("processInboundMessage calls sendText exactly once for a valid text message", async () => {
    const { sendText, calls } = fakeSender({ success: true, messageId: "wamid.OUT1", error: null });

    await processInboundMessage(textMessage(), { sendText });

    assert.equal(calls.length, 1);
});

// B) to utilizado coincide con message.from.
test("processInboundMessage sends to exactly message.from", async () => {
    const { sendText, calls } = fakeSender({ success: true, messageId: "wamid.OUT1", error: null });

    await processInboundMessage(textMessage({ from: "5491100009999" }), { sendText });

    assert.equal(calls[0].to, "5491100009999");
});

// C) texto enviado es exactamente el fijo esperado.
test("processInboundMessage sends exactly the fixed greeting text", async () => {
    const { sendText, calls } = fakeSender({ success: true, messageId: "wamid.OUT1", error: null });

    await processInboundMessage(textMessage({ text: "cualquier cosa que haya escrito el usuario" }), { sendText });

    assert.equal(calls[0].text, "¡Hola! 👋 Soy el asistente de PaseCultural. ¿Querés publicar un evento?");
    assert.equal(calls[0].text, AUTO_REPLY_TEXT);
});

// E) Fase 2D.1 — con WHATSAPP_TEST_MODE=true, un inbound argentino con el
// "9" de móvil se normaliza antes de llamar a sendText. Restaura la
// variable de entorno al terminar para no afectar los tests B/J de más
// arriba/abajo, que asumen `to === message.from` sin normalizar.
test("processInboundMessage sends to the normalized Argentine recipient when WHATSAPP_TEST_MODE is enabled", async () => {
    const previousTestMode = process.env.WHATSAPP_TEST_MODE;
    process.env.WHATSAPP_TEST_MODE = "true";

    const { sendText, calls } = fakeSender({ success: true, messageId: "wamid.OUT1", error: null });

    try {
        await processInboundMessage(textMessage({ from: "5492984405532" }), { sendText });
    } finally {
        if (previousTestMode === undefined) delete process.env.WHATSAPP_TEST_MODE;
        else process.env.WHATSAPP_TEST_MODE = previousTestMode;
    }

    assert.equal(calls[0].to, "542984405532");
});

// F/G a nivel de orquestación: no se llama a sendText en absoluto.
test("processInboundMessage never calls sendText when text is null/blank", async () => {
    const nullText = fakeSender({ success: true, messageId: "x", error: null });
    const blankText = fakeSender({ success: true, messageId: "x", error: null });

    await processInboundMessage(textMessage({ text: null }), { sendText: nullText.sendText });
    await processInboundMessage(textMessage({ text: "   " }), { sendText: blankText.sendText });

    assert.equal(nullText.calls.length, 0);
    assert.equal(blankText.calls.length, 0);
});

// H) sendText resuelve success:false -> no lanza (webhook seguiría en 200).
test("processInboundMessage resolves without throwing when Meta rejects the send", async () => {
    const { sendText } = fakeSender({ success: false, messageId: null, error: "Recipient not in allowed list" });

    await assert.doesNotReject(() => processInboundMessage(textMessage(), { sendText }));
});

// I) error inesperado durante el envío -> no lanza (webhook seguiría en 200).
test("processInboundMessage resolves without throwing when sendText itself throws", async () => {
    const { sendText } = fakeSender(new Error("network exploded"));

    await assert.doesNotReject(() => processInboundMessage(textMessage(), { sendText }));
});

// ==================================================
// processInboundMessages — múltiples mensajes en el mismo POST
// ==================================================

// J) dos mensajes text válidos -> procesa ambos, una respuesta por cada uno.
test("processInboundMessages replies once per valid text message, preserving each recipient", async () => {
    const { sendText, calls } = fakeSender({ success: true, messageId: "wamid.OUT", error: null });
    const messages = [
        textMessage({ messageId: "wamid.IN1", from: "5491100000001", text: "Hola" }),
        textMessage({ messageId: "wamid.IN2", from: "5491100000002", text: "Buenas" }),
    ];

    await processInboundMessages(messages, { sendText });

    assert.equal(calls.length, 2);
    assert.deepEqual(
        calls.map((c) => c.to),
        ["5491100000001", "5491100000002"]
    );
    assert.ok(calls.every((c) => c.text === AUTO_REPLY_TEXT));
});

test("processInboundMessages skips non-eligible messages within a mixed batch", async () => {
    const { sendText, calls } = fakeSender({ success: true, messageId: "wamid.OUT", error: null });
    const messages = [
        textMessage({ from: "5491100000001", text: "Hola" }),
        textMessage({ from: "5491100000002", type: "image", text: null }),
        textMessage({ from: "5491100000003", text: "  " }),
    ];

    await processInboundMessages(messages, { sendText });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, "5491100000001");
});

// ==================================================
// receiveWhatsappWebhook — end-to-end real, con fetch mockeado (sin red real)
// ==================================================

function mockFetch(handler) {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (...args) => {
        callCount += 1;
        return handler(...args);
    };
    return {
        restore: () => {
            globalThis.fetch = originalFetch;
        },
        getCallCount: () => callCount,
    };
}

function statusUpdatePayload() {
    return {
        entry: [{ changes: [{ value: { metadata: { phone_number_id: "PHONE_ID_1" }, statuses: [{ id: "wamid.S1", status: "delivered" }] } }] }],
    };
}

function textPayload({ from = "5491122334455", text = "Hola" } = {}) {
    return {
        entry: [
            {
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: "PHONE_ID_1" },
                            contacts: [{ profile: { name: "Elvis Bar" }, wa_id: from }],
                            messages: [{ id: "wamid.IN1", from, timestamp: "1700000000", type: "text", text: { body: text } }],
                        },
                    },
                ],
            },
        ],
    };
}

function imagePayload({ from = "5491122334455" } = {}) {
    return {
        entry: [
            {
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: "PHONE_ID_1" },
                            messages: [{ id: "wamid.IN2", from, timestamp: "1700000001", type: "image", image: { id: "media-1" } }],
                        },
                    },
                ],
            },
        ],
    };
}

function fakeRes() {
    let statusSent;
    return { res: { sendStatus: (code) => { statusSent = code; } }, getStatus: () => statusSent };
}

// Env vars ya quedaron configuradas por tests/whatsapp.send.test.js dentro
// del mismo proceso de test file (cada archivo corre en su propio proceso
// con node --test) — acá se configuran de nuevo por las dudas, antes de
// que receiveWhatsappWebhook dispare sendWhatsappTextMessage de verdad.
process.env.WHATSAPP_ACCESS_TOKEN ||= "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID ||= "PHONE_ID_1";
process.env.WHATSAPP_GRAPH_API_VERSION ||= "v26.0";

// D) status update -> no envía nada (fetch nunca se llama), webhook 200.
test("receiveWhatsappWebhook never calls the Graph API for a status-only payload, and still returns 200", async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "x" }] }) }));
    const { res, getStatus } = fakeRes();

    try {
        await receiveWhatsappWebhook({ body: statusUpdatePayload() }, res);
    } finally {
        fetchMock.restore();
    }

    assert.equal(fetchMock.getCallCount(), 0);
    assert.equal(getStatus(), 200);
});

// E) mensaje image -> no envía nada, webhook 200.
test("receiveWhatsappWebhook never calls the Graph API for an image message, and still returns 200", async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "x" }] }) }));
    const { res, getStatus } = fakeRes();

    try {
        await receiveWhatsappWebhook({ body: imagePayload() }, res);
    } finally {
        fetchMock.restore();
    }

    assert.equal(fetchMock.getCallCount(), 0);
    assert.equal(getStatus(), 200);
});

// H) Meta rechaza el envío saliente (HTTP no-ok real, vía fetch mockeado) -> webhook sigue en 200.
test("receiveWhatsappWebhook still returns 200 when Meta rejects the outbound reply", async () => {
    const fetchMock = mockFetch(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Recipient phone number not in allowed list" } }),
    }));
    const { res, getStatus } = fakeRes();

    try {
        await receiveWhatsappWebhook({ body: textPayload() }, res);
    } finally {
        fetchMock.restore();
    }

    assert.equal(fetchMock.getCallCount(), 1);
    assert.equal(getStatus(), 200);
});

// I) error de red real al intentar responder -> webhook sigue en 200.
test("receiveWhatsappWebhook still returns 200 when the outbound reply fails with a network error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("network exploded");
    };
    const { res, getStatus } = fakeRes();

    try {
        await receiveWhatsappWebhook({ body: textPayload() }, res);
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(getStatus(), 200);
});

// Camino feliz end-to-end: mensaje text válido -> Meta acepta -> 200.
test("receiveWhatsappWebhook returns 200 and replies once for a valid inbound text message", async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.OUT1" }] }) }));
    const { res, getStatus } = fakeRes();

    try {
        await receiveWhatsappWebhook({ body: textPayload({ text: "Hola" }) }, res);
    } finally {
        fetchMock.restore();
    }

    assert.equal(fetchMock.getCallCount(), 1);
    assert.equal(getStatus(), 200);
});
