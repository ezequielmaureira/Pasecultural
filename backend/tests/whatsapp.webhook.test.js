import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWebhookVerification, parseInboundWhatsappMessages } from "../src/services/whatsapp.service.js";
import { receiveWhatsappWebhook } from "../src/controllers/whatsapp.controller.js";

// Payload real de Meta (forma simplificada, campos irrelevantes omitidos)
// para un mensaje de texto entrante con su contacto asociado.
function buildTextMessagePayload({ from = "5491122334455", contacts } = {}) {
    return {
        object: "whatsapp_business_account",
        entry: [
            {
                id: "entry-1",
                changes: [
                    {
                        field: "messages",
                        value: {
                            messaging_product: "whatsapp",
                            metadata: { display_phone_number: "5491100000000", phone_number_id: "PHONE_ID_1" },
                            contacts: contacts ?? [{ profile: { name: "Elvis Bar" }, wa_id: from }],
                            messages: [{ id: "wamid.A", from, timestamp: "1700000000", type: "text", text: { body: "Hola" } }],
                        },
                    },
                ],
            },
        ],
    };
}

// A) GET con verify_token correcto -> verificado, devuelve el challenge tal cual.
test("evaluateWebhookVerification accepts subscribe + matching token and returns the challenge", () => {
    const result = evaluateWebhookVerification(
        { mode: "subscribe", token: "correct-token", challenge: "12345" },
        "correct-token"
    );
    assert.deepEqual(result, { verified: true, challenge: "12345" });
});

// B) GET con verify_token incorrecto -> rechazado.
test("evaluateWebhookVerification rejects a mismatched verify_token", () => {
    const result = evaluateWebhookVerification(
        { mode: "subscribe", token: "wrong-token", challenge: "12345" },
        "correct-token"
    );
    assert.equal(result.verified, false);
});

test("evaluateWebhookVerification rejects a mode other than subscribe", () => {
    const result = evaluateWebhookVerification(
        { mode: "unsubscribe", token: "correct-token", challenge: "12345" },
        "correct-token"
    );
    assert.equal(result.verified, false);
});

test("evaluateWebhookVerification rejects a missing challenge", () => {
    const result = evaluateWebhookVerification({ mode: "subscribe", token: "correct-token", challenge: "" }, "correct-token");
    assert.equal(result.verified, false);
});

// C) POST válido -> HTTP 200. Sin supertest en el proyecto: se llama al
// controller directo con un req/res mínimo, mismo criterio que el resto de
// tests/*.test.js (probar la función real, no levantar un server HTTP).
test("receiveWhatsappWebhook always responds 200 without touching the database", () => {
    const req = { body: { object: "whatsapp_business_account", entry: [{ id: "1" }] } };
    let statusSent;
    const res = { sendStatus: (code) => { statusSent = code; } };

    receiveWhatsappWebhook(req, res);

    assert.equal(statusSent, 200);
});

// ==================================================
// parseInboundWhatsappMessages — Fase 2B
// ==================================================

// A) mensaje text válido -> objeto normalizado correcto.
test("parseInboundWhatsappMessages normalizes a valid text message", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });

    const messages = parseInboundWhatsappMessages(payload);

    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
        messageId: "wamid.A",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "Hola",
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
    });
});

// B) profileName asociado mediante wa_id/from, no por posición en contacts[].
test("parseInboundWhatsappMessages associates profileName via wa_id, not contacts[0]", () => {
    const payload = buildTextMessagePayload({
        from: "5491122334455",
        contacts: [
            { profile: { name: "Otro contacto" }, wa_id: "5491199999999" },
            { profile: { name: "Elvis Bar" }, wa_id: "5491122334455" },
        ],
    });

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.profileName, "Elvis Bar");
});

// C) mensaje text sin contacts -> no rompe, profileName = null.
test("parseInboundWhatsappMessages keeps profileName null when contacts is missing", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455", contacts: undefined });
    delete payload.entry[0].changes[0].value.contacts;

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.profileName, null);
    assert.equal(message.text, "Hola");
});

// D) payload de status (sin messages) -> [].
test("parseInboundWhatsappMessages returns [] for a status update payload", () => {
    const payload = {
        object: "whatsapp_business_account",
        entry: [
            {
                id: "entry-1",
                changes: [
                    {
                        field: "messages",
                        value: {
                            messaging_product: "whatsapp",
                            metadata: { phone_number_id: "PHONE_ID_1" },
                            statuses: [{ id: "wamid.A", status: "delivered", timestamp: "1700000001" }],
                        },
                    },
                ],
            },
        ],
    };

    assert.deepEqual(parseInboundWhatsappMessages(payload), []);
});

// E) entry vacío -> [].
test("parseInboundWhatsappMessages returns [] when entry is empty", () => {
    assert.deepEqual(parseInboundWhatsappMessages({ object: "whatsapp_business_account", entry: [] }), []);
});

// también: entry ausente / no-array, no debe romper.
test("parseInboundWhatsappMessages returns [] when entry is missing or malformed", () => {
    assert.deepEqual(parseInboundWhatsappMessages({}), []);
    assert.deepEqual(parseInboundWhatsappMessages(null), []);
    assert.deepEqual(parseInboundWhatsappMessages({ entry: "not-an-array" }), []);
});

// F) changes vacío -> [].
test("parseInboundWhatsappMessages returns [] when changes is empty", () => {
    const payload = { entry: [{ id: "entry-1", changes: [] }] };
    assert.deepEqual(parseInboundWhatsappMessages(payload), []);
});

// G) mensaje image -> type="image", text=null.
test("parseInboundWhatsappMessages tolerates an image message without extracting text", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });
    payload.entry[0].changes[0].value.messages = [
        { id: "wamid.B", from: "5491122334455", timestamp: "1700000002", type: "image", image: { id: "media-1" } },
    ];

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.type, "image");
    assert.equal(message.text, null);
    assert.equal(message.messageId, "wamid.B");
});

// H) tipo desconocido -> conserva type, text=null, no rompe.
test("parseInboundWhatsappMessages tolerates an unknown/future message type", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });
    payload.entry[0].changes[0].value.messages = [
        { id: "wamid.C", from: "5491122334455", timestamp: "1700000003", type: "some_future_type" },
    ];

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.type, "some_future_type");
    assert.equal(message.text, null);
});

// I) múltiples entry/changes/messages -> devuelve todos.
test("parseInboundWhatsappMessages flattens multiple entries/changes/messages", () => {
    const payload = {
        entry: [
            {
                id: "entry-1",
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: "PHONE_ID_1" },
                            contacts: [{ profile: { name: "A" }, wa_id: "111" }],
                            messages: [{ id: "wamid.1", from: "111", timestamp: "1", type: "text", text: { body: "uno" } }],
                        },
                    },
                    {
                        value: {
                            metadata: { phone_number_id: "PHONE_ID_1" },
                            contacts: [{ profile: { name: "B" }, wa_id: "222" }],
                            messages: [{ id: "wamid.2", from: "222", timestamp: "2", type: "text", text: { body: "dos" } }],
                        },
                    },
                ],
            },
            {
                id: "entry-2",
                changes: [
                    {
                        value: {
                            metadata: { phone_number_id: "PHONE_ID_2" },
                            contacts: [{ profile: { name: "C" }, wa_id: "333" }],
                            messages: [{ id: "wamid.3", from: "333", timestamp: "3", type: "text", text: { body: "tres" } }],
                        },
                    },
                ],
            },
        ],
    };

    const messages = parseInboundWhatsappMessages(payload);

    assert.deepEqual(
        messages.map((m) => m.messageId),
        ["wamid.1", "wamid.2", "wamid.3"]
    );
    assert.deepEqual(messages.map((m) => m.profileName), ["A", "B", "C"]);
});

// ==================================================
// receiveWhatsappWebhook (controller) — Fase 2B
// ==================================================

// J) POST con payload válido (con mensajes) -> HTTP 200.
test("receiveWhatsappWebhook responds 200 when the payload contains real messages", () => {
    const req = { body: buildTextMessagePayload({ from: "5491122334455" }) };
    let statusSent;
    const res = { sendStatus: (code) => { statusSent = code; } };

    receiveWhatsappWebhook(req, res);

    assert.equal(statusSent, 200);
});

// K) POST con payload sin mensajes (status update) -> HTTP 200.
test("receiveWhatsappWebhook responds 200 for a status-only payload", () => {
    const req = {
        body: {
            entry: [{ changes: [{ value: { statuses: [{ id: "wamid.A", status: "read" }] } }] }],
        },
    };
    let statusSent;
    const res = { sendStatus: (code) => { statusSent = code; } };

    receiveWhatsappWebhook(req, res);

    assert.equal(statusSent, 200);
});
