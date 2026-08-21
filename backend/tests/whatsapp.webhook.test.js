import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { evaluateWebhookVerification, parseInboundWhatsappMessages } from "../src/services/whatsapp.service.js";
import { receiveWhatsappWebhook } from "../src/controllers/whatsapp.controller.js";

// Verificación de teléfono de Organizaciones — auditoría: receiveWhatsappWebhook
// ahora exige una firma X-Hub-Signature-256 válida (ver
// config/whatsappWebhookSignature.js) antes de procesar nada. Fijada UNA
// vez acá arriba, mismo criterio LAZY que el resto de whatsapp.service.js.
process.env.WHATSAPP_APP_SECRET = "test-webhook-app-secret";

// Arma un `req` fake que se comporta como uno real de Express en lo único
// que receiveWhatsappWebhook necesita: rawBody (los bytes exactos que
// firma el HMAC, ver app.js#express.json({verify})) y req.get(header).
function buildSignedReq(bodyObject) {
    const rawBody = Buffer.from(JSON.stringify(bodyObject));
    const signature = `sha256=${crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex")}`;
    return {
        body: bodyObject,
        rawBody,
        get: (header) => (header === "X-Hub-Signature-256" ? signature : undefined),
    };
}

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
    const req = buildSignedReq({ object: "whatsapp_business_account", entry: [{ id: "1" }] });
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
        image: null,
        location: null,
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

// G.1) bug fix (carga de imagen del evento) — un mensaje image conserva
// media id, mime_type, sha256 y caption tal cual los manda Meta.
test("parseInboundWhatsappMessages preserves the real WhatsApp media id, mime_type, sha256 and caption for an image message", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });
    payload.entry[0].changes[0].value.messages = [
        {
            id: "wamid.B",
            from: "5491122334455",
            timestamp: "1700000002",
            type: "image",
            image: { id: "media-1", mime_type: "image/jpeg", sha256: "abc123", caption: "portada del evento" },
        },
    ];

    const [message] = parseInboundWhatsappMessages(payload);

    assert.deepEqual(message.image, {
        id: "media-1",
        mimeType: "image/jpeg",
        sha256: "abc123",
        caption: "portada del evento",
    });
});

// G.2) un mensaje type="image" sin `image.id` (payload malformado/inesperado)
// nunca rompe el parseo — queda con image=null.
test("parseInboundWhatsappMessages returns image=null for a malformed image message without an id", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });
    payload.entry[0].changes[0].value.messages = [
        { id: "wamid.B", from: "5491122334455", timestamp: "1700000002", type: "image" },
    ];

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.image, null);
});

// G.3) un mensaje de texto nunca trae `image` (queda null, no undefined ni el objeto de otro mensaje).
test("parseInboundWhatsappMessages keeps image=null for a text message", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.image, null);
});

// ==================================================
// Bug fix (ubicación por WhatsApp Location) — mensaje type="location".
// Contrato real de la Cloud API: latitude/longitude siempre; name/address
// sólo cuando el usuario compartió un LUGAR buscado, no una ubicación en
// vivo. Nunca ciudad/provincia — Meta no las entrega.
// ==================================================

// M.1) ubicación EN VIVO (sin lugar buscado): sólo latitude/longitude, sin
// name ni address — igual conserva latitude/longitude correctamente.
test("parseInboundWhatsappMessages preserves latitude and longitude for a live location message", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });
    payload.entry[0].changes[0].value.messages = [
        { id: "wamid.L1", from: "5491122334455", timestamp: "1700000004", type: "location", location: { latitude: -34.603722, longitude: -58.381592 } },
    ];

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.type, "location");
    assert.deepEqual(message.location, { latitude: -34.603722, longitude: -58.381592, name: null, address: null });
});

// M.2) LUGAR buscado y seleccionado (el caso deseado por el producto):
// conserva name y address además de latitude/longitude.
test("parseInboundWhatsappMessages preserves name and address when the user shared a searched place", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });
    payload.entry[0].changes[0].value.messages = [
        {
            id: "wamid.L2",
            from: "5491122334455",
            timestamp: "1700000005",
            type: "location",
            location: { latitude: -31.4201, longitude: -64.1888, name: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365, Córdoba" },
        },
    ];

    const [message] = parseInboundWhatsappMessages(payload);

    assert.deepEqual(message.location, {
        latitude: -31.4201,
        longitude: -64.1888,
        name: "Teatro del Libertador",
        address: "Av. Vélez Sarsfield 365, Córdoba",
    });
});

// M.3) sin latitude/longitude numéricos reales (payload malformado/inesperado)
// nunca rompe el parseo — queda con location=null, nunca inventa coordenadas.
test("parseInboundWhatsappMessages returns location=null for a malformed location message without real coordinates", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });
    payload.entry[0].changes[0].value.messages = [
        { id: "wamid.L3", from: "5491122334455", timestamp: "1700000006", type: "location", location: { name: "Sin coordenadas" } },
    ];

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.location, null);
});

// M.4) un mensaje de texto/imagen nunca trae `location` (queda null).
test("parseInboundWhatsappMessages keeps location=null for a text message", () => {
    const payload = buildTextMessagePayload({ from: "5491122334455" });

    const [message] = parseInboundWhatsappMessages(payload);

    assert.equal(message.location, null);
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

// J) POST con payload válido (con mensajes) y firma real -> HTTP 200.
test("receiveWhatsappWebhook responds 200 when the payload contains real messages and the signature is valid", () => {
    const req = buildSignedReq(buildTextMessagePayload({ from: "5491122334455" }));
    let statusSent;
    const res = { sendStatus: (code) => { statusSent = code; } };

    receiveWhatsappWebhook(req, res);

    assert.equal(statusSent, 200);
});

// K) POST con payload sin mensajes (status update) y firma real -> HTTP 200.
test("receiveWhatsappWebhook responds 200 for a status-only payload with a valid signature", () => {
    const req = buildSignedReq({
        entry: [{ changes: [{ value: { statuses: [{ id: "wamid.A", status: "read" }] } }] }],
    });
    let statusSent;
    const res = { sendStatus: (code) => { statusSent = code; } };

    receiveWhatsappWebhook(req, res);

    assert.equal(statusSent, 200);
});

// Verificación de teléfono de Organizaciones — auditoría: cubre
// explícitamente el fail-closed nuevo (sin esto, cualquiera que conozca la
// URL podría mandar payloads falsos, ver el informe de entrega).
test("receiveWhatsappWebhook rejects a request with an invalid/forged signature (401), never processes it", () => {
    const req = {
        body: buildTextMessagePayload({ from: "5491122334455" }),
        rawBody: Buffer.from(JSON.stringify(buildTextMessagePayload({ from: "5491122334455" }))),
        get: (header) => (header === "X-Hub-Signature-256" ? "sha256=" + "0".repeat(64) : undefined),
    };
    let statusSent;
    const res = { sendStatus: (code) => { statusSent = code; } };

    receiveWhatsappWebhook(req, res);

    assert.equal(statusSent, 401);
});

test("receiveWhatsappWebhook rejects a request with no signature header at all (401)", () => {
    const req = {
        body: buildTextMessagePayload({ from: "5491122334455" }),
        rawBody: Buffer.from(JSON.stringify(buildTextMessagePayload({ from: "5491122334455" }))),
        get: () => undefined,
    };
    let statusSent;
    const res = { sendStatus: (code) => { statusSent = code; } };

    receiveWhatsappWebhook(req, res);

    assert.equal(statusSent, 401);
});
