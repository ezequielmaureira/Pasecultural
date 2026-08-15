import test from "node:test";
import assert from "node:assert/strict";
import { sendWhatsappTextMessage, sendWhatsappTemplateMessage, sendWhatsappOtpTemplate, sendWhatsappWelcomeTemplate } from "../src/services/whatsapp.service.js";

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

// ==================================================================
// sendWhatsappTemplateMessage / sendWhatsappOtpTemplate / sendWhatsappWelcomeTemplate
// Fase "cambio de número de WhatsApp" — mensajes template, nunca texto
// libre (necesarios fuera de la ventana de 24hs, ver el informe de
// entrega). Mismos WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID/GRAPH_API_VERSION
// que sendWhatsappTextMessage ya deja configurados/cacheados arriba.
// ==================================================================

test("sendWhatsappTemplateMessage builds the correct template payload with a body variable", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1242890615575090";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v26.0";

    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedOptions = options;
        return jsonResponse(200, { messages: [{ id: "wamid.TPL" }] });
    });

    try {
        await sendWhatsappTemplateMessage({ to: "5491122334455", templateName: "otp_template", languageCode: "es_AR", bodyParameters: ["123456"] });
    } finally {
        restore();
    }

    assert.deepEqual(JSON.parse(capturedOptions.body), {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "5491122334455",
        type: "template",
        template: {
            name: "otp_template",
            language: { code: "es_AR" },
            components: [{ type: "body", parameters: [{ type: "text", text: "123456" }] }],
        },
    });
});

test("sendWhatsappTemplateMessage omits the body component entirely when there are no variables", async () => {
    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedOptions = options;
        return jsonResponse(200, { messages: [{ id: "wamid.TPL" }] });
    });

    try {
        await sendWhatsappTemplateMessage({ to: "5491122334455", templateName: "no_vars_template", languageCode: "en_US" });
    } finally {
        restore();
    }

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.template.components, undefined);
});

test("sendWhatsappOtpTemplate throws a clear configuration error when the OTP template env vars are missing", async () => {
    const originalName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    const originalLang = process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE;
    delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    delete process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE;

    try {
        await assert.rejects(
            () => sendWhatsappOtpTemplate({ to: "5491122334455", code: "123456" }),
            /Falta configurar la variable de entorno WHATSAPP_OTP_TEMPLATE_NAME/
        );
    } finally {
        if (originalName !== undefined) process.env.WHATSAPP_OTP_TEMPLATE_NAME = originalName;
        if (originalLang !== undefined) process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE = originalLang;
    }
});

test("sendWhatsappOtpTemplate sends the code as the single body variable once configured", async () => {
    process.env.WHATSAPP_OTP_TEMPLATE_NAME = "whatsapp_number_change_otp";
    process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE = "es_AR";

    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedOptions = options;
        return jsonResponse(200, { messages: [{ id: "wamid.OTP" }] });
    });

    try {
        const result = await sendWhatsappOtpTemplate({ to: "5491122334455", code: "654321" });
        assert.equal(result.success, true);
    } finally {
        restore();
    }

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.template.name, "whatsapp_number_change_otp");
    assert.equal(body.template.language.code, "es_AR");
    assert.deepEqual(body.template.components, [{ type: "body", parameters: [{ type: "text", text: "654321" }] }]);
});

// Nunca lanza si la plantilla de bienvenida no está configurada — es
// best-effort por diseño (ver whatsappNumberChange.service.js): una
// migración ya confirmada no debe fallar ni revertirse por esto.
test("sendWhatsappWelcomeTemplate returns a controlled failure (never throws) when its template env vars are not configured", async () => {
    const originalName = process.env.WHATSAPP_WELCOME_TEMPLATE_NAME;
    const originalLang = process.env.WHATSAPP_WELCOME_TEMPLATE_LANGUAGE;
    delete process.env.WHATSAPP_WELCOME_TEMPLATE_NAME;
    delete process.env.WHATSAPP_WELCOME_TEMPLATE_LANGUAGE;

    let result;
    try {
        result = await sendWhatsappWelcomeTemplate({ to: "5491122334455", firstName: "Nadia", organizationName: "Cine Nadia" });
    } finally {
        if (originalName !== undefined) process.env.WHATSAPP_WELCOME_TEMPLATE_NAME = originalName;
        if (originalLang !== undefined) process.env.WHATSAPP_WELCOME_TEMPLATE_LANGUAGE = originalLang;
    }

    assert.deepEqual(result, { success: false, messageId: null, error: "WELCOME_TEMPLATE_NOT_CONFIGURED" });
});
