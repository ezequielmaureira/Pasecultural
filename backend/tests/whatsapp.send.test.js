import test from "node:test";
import assert from "node:assert/strict";
import { sendWhatsappTextMessage } from "../src/services/whatsapp.service.js";

// sendWhatsappTextMessage lee WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID/
// WHATSAPP_GRAPH_API_VERSION de forma LAZY y los cachea en memoria de módulo
// tras la primera lectura exitosa (mismo criterio que config/scannerSession.js).
// Por eso el test F (variables de entorno faltantes) tiene que correr ANTES
// que cualquier otro test de este archivo: una vez que un test exitoso
// cachea un valor, ya no vuelve a leer process.env en esta misma corrida.
// El resto de los tests recién setea las 3 variables adentro suyo.

function mockFetchOnce(handler) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = originalFetch;
    };
}

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

// F) faltan variables de entorno -> falla de forma explícita y segura.
// Corre primero a propósito (ver comentario de arriba).
test("sendWhatsappTextMessage throws a clear error when env vars are not configured yet", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_GRAPH_API_VERSION;

    // No se asume cuál de las 3 variables se valida primero: alcanza con
    // que falle explícitamente señalando cuál falta configurar.
    await assert.rejects(
        () => sendWhatsappTextMessage({ to: "5491100000000", text: "hola" }),
        /Falta configurar la variable de entorno WHATSAPP_/
    );
});

// A) URL correcta usando VERSION + PHONE_NUMBER_ID.
// B) Authorization Bearer sin exponer el token en ningún otro lugar.
// C) body correcto para mensaje text.
test("sendWhatsappTextMessage builds the correct URL, auth header and body", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1242890615575090";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v26.0";

    let capturedUrl;
    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return jsonResponse(200, { messages: [{ id: "wamid.SENT" }] });
    });

    try {
        await sendWhatsappTextMessage({ to: "5491122334455", text: "Conexión PaseCultural OK" });
    } finally {
        restore();
    }

    assert.equal(capturedUrl, "https://graph.facebook.com/v26.0/1242890615575090/messages");
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers.Authorization, "Bearer test-access-token");
    assert.equal(capturedOptions.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(capturedOptions.body), {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "5491122334455",
        type: "text",
        text: { body: "Conexión PaseCultural OK" },
    });
});

// D) respuesta 200 con messages[0].id -> resultado normalizado correcto.
test("sendWhatsappTextMessage returns a normalized success result", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, { messages: [{ id: "wamid.HELLO" }] }));

    let result;
    try {
        result = await sendWhatsappTextMessage({ to: "5491122334455", text: "hola" });
    } finally {
        restore();
    }

    assert.deepEqual(result, { success: true, messageId: "wamid.HELLO", error: null });
});

// E) Meta responde error HTTP -> error controlado (nunca lanza).
test("sendWhatsappTextMessage returns a controlled error when Meta rejects the message", async () => {
    const restore = mockFetchOnce(async () =>
        jsonResponse(400, { error: { message: "Recipient phone number not in allowed list", code: 131030 } })
    );

    let result;
    try {
        result = await sendWhatsappTextMessage({ to: "5491100000000", text: "hola" });
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.messageId, null);
    assert.equal(result.error, "Recipient phone number not in allowed list");
});

// G) timeout/error de red -> error controlado (nunca lanza).
test("sendWhatsappTextMessage returns a controlled error on a network failure", async () => {
    const restore = mockFetchOnce(async () => {
        throw new Error("fetch failed");
    });

    let result;
    try {
        result = await sendWhatsappTextMessage({ to: "5491100000000", text: "hola" });
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.error, "NETWORK_ERROR");
});
