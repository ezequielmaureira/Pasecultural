import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "../src/logging/logger.js";
import { handleMercadoPagoWebhook } from "../src/controllers/mercadoPagoWebhook.controller.js";

// MP-3 (auditoría de ráfagas de "firma inválida") — instrumentación
// diagnóstica agregada EXCLUSIVAMENTE dentro de la rama
// `if (!validSignature)` de handleMercadoPagoWebhook. Estos tests prueban
// esa rama a nivel HTTP (req/res falsos, sin Express real).
//
// Para la rama de firma VÁLIDA (requisito 5) se prueba por inspección
// estática que el código posterior a la rama modificada sigue byte a byte
// igual a como estaba antes de este cambio — a propósito, para NUNCA
// ejecutar processMercadoPagoWebhookNotification de verdad en este
// archivo: esa función toca Prisma (ver mercadoPagoWebhook.service.js,
// probado aparte con DB real en mercadoPagoWebhook.service.test.js,
// gateado por testWithDb/dbGuard.js). Este archivo debe poder correr como
// test:unit, sin DB, en cualquier entorno — importar el controller ya
// arrastra @prisma/client transitivamente (ver el comentario histórico en
// tests/helpers/runTests.mjs sobre el incidente real de contaminación de
// producción), así que ningún test de este archivo debe llegar jamás a
// ejecutar una query real: el camino de firma inválida/ausente corta con
// un `return` antes de tocar el service, y el camino de firma válida ni
// siquiera se ejercita en runtime acá — sólo se lee su código fuente.

process.env.MERCADOPAGO_WEBHOOK_SECRET = "diagnostics-test-secret-xyz";

const controllerPath = fileURLToPath(new URL("../src/controllers/mercadoPagoWebhook.controller.js", import.meta.url));

function fakeReq({ headers = {}, query = {}, body = {} } = {}) {
    return { headers, query, body };
}

function fakeRes() {
    const state = { statusCode: undefined, jsonBody: undefined, ended: false };
    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        json(payload) {
            state.jsonBody = payload;
            return res;
        },
        end() {
            state.ended = true;
            return res;
        },
    };
    return { res, state };
}

async function withWarnSpy(run) {
    const originalWarn = logger.warn;
    const calls = [];
    logger.warn = (message, context) => calls.push({ message, context });
    try {
        return await run(calls);
    } finally {
        logger.warn = originalWarn;
    }
}

// Auditoría "endurecer webhook" — mismo patrón que withWarnSpy, para el
// log único de entrada y el log explícito de IPN legado (ambos
// logger.info).
async function withInfoSpy(run) {
    const originalInfo = logger.info;
    const calls = [];
    logger.info = (message, context) => calls.push({ message, context });
    try {
        return await run(calls);
    } finally {
        logger.info = originalInfo;
    }
}

function malformedSignatureHeader() {
    return "garbage-not-even-kv-pairs";
}

function wellFormedButWrongSignatureHeader({ dataId, requestId, ts, secret }) {
    let manifest = "";
    if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    return `ts=${ts},v1=${v1}`;
}

// ==================================================================
// 1) Firma inválida sigue respondiendo 401.
// ==================================================================
test("1) an invalid (well-formed but wrong) signature still responds 401 INVALID_SIGNATURE, exactly as before", async () => {
    const xSignature = wellFormedButWrongSignatureHeader({
        dataId: "123456789",
        requestId: "req-1",
        ts: "1704908010",
        secret: "a-completely-different-secret",
    });
    const req = fakeReq({
        headers: { "x-signature": xSignature, "x-request-id": "req-1" },
        query: { "data.id": "123456789", type: "payment" },
    });
    const { res, state } = fakeRes();

    await withWarnSpy(async () => {
        await handleMercadoPagoWebhook(req, res);
    });

    assert.equal(state.statusCode, 401);
    assert.deepEqual(state.jsonBody, { received: false, error: "INVALID_SIGNATURE" });
});

// ==================================================================
// 2) Firma inválida nunca llega a processMercadoPagoWebhookNotification —
// probado en dos niveles: (a) comportamiento — responde 401 sin colgarse,
// nunca un status de negocio (200/500) que sólo puede devolver el service;
// (b) estructura del código fuente — el `return` de la rama de firma
// inválida aparece ANTES del único lugar donde se llama al service.
// ==================================================================
test("2) an invalid signature never reaches processMercadoPagoWebhookNotification", async () => {
    const source = readFileSync(controllerPath, "utf8");
    const invalidBranchStart = source.indexOf("if (!validSignature)");
    const serviceCallIndex = source.indexOf("processMercadoPagoWebhookNotification({");
    assert.ok(invalidBranchStart !== -1, "no encontré la rama de firma inválida en el controller");
    assert.ok(serviceCallIndex !== -1, "no encontré el llamado al service en el controller");
    assert.ok(
        invalidBranchStart < serviceCallIndex,
        "la rama de firma inválida debe aparecer, en el código fuente, antes del único llamado al service"
    );
    const invalidBranchBlock = source.slice(invalidBranchStart, serviceCallIndex);
    assert.ok(
        invalidBranchBlock.includes("return res.status(401)"),
        "la rama de firma inválida debe cortar con un return antes de poder llegar al service"
    );

    // Comportamiento real en paralelo: responde 401 (nunca 200/500 de
    // negocio) para una firma malformada.
    const req = fakeReq({ headers: { "x-signature": malformedSignatureHeader() } });
    const { res, state } = fakeRes();
    await withWarnSpy(async () => {
        await handleMercadoPagoWebhook(req, res);
    });
    assert.equal(state.statusCode, 401);
});

// ==================================================================
// 3/4) El logging diagnóstico nunca contiene x-signature completo, v1,
// HMAC, ni el secret real — sólo metadata no sensible.
// ==================================================================
test("3/4) the diagnostic log for an invalid signature never leaks x-signature, v1, or the real secret", async () => {
    const configuredSecret = "diagnostics-test-secret-xyz";
    const xSignature = wellFormedButWrongSignatureHeader({
        dataId: "987654321",
        requestId: "req-leak-check",
        ts: "1704999999",
        secret: "wrong-secret-not-the-configured-one",
    });
    const req = fakeReq({
        headers: {
            "x-signature": xSignature,
            "x-request-id": "req-leak-check",
            "user-agent": "MercadoPago Webhooks/1.0",
            "content-type": "application/json",
        },
        query: { "data.id": "987654321", type: "payment", action: "payment.created" },
        body: { data: { id: "987654321" }, type: "payment", action: "payment.created" },
    });
    const { res } = fakeRes();

    const calls = await withWarnSpy(async (calls) => {
        await handleMercadoPagoWebhook(req, res);
        return calls;
    });

    const entry = calls.find((c) => c.message === "mercadopago webhook: firma inválida");
    assert.ok(entry, "esperaba un log de firma inválida");
    const serialized = JSON.stringify(entry);

    const v1FromRequest = xSignature.split("v1=")[1];
    assert.ok(!serialized.includes(xSignature), "el log no debe incluir el header x-signature completo");
    assert.ok(!serialized.includes(v1FromRequest), "el log no debe incluir el valor v1/HMAC");
    assert.ok(!serialized.includes(configuredSecret), "el log no debe incluir el secret configurado");
    assert.ok(!serialized.toLowerCase().includes("authorization"), "el log no debe incluir headers de autorización");
    assert.ok(!serialized.toLowerCase().includes("access_token"), "el log no debe incluir tokens");
    assert.ok(!serialized.toLowerCase().includes("refresh_token"), "el log no debe incluir tokens");

    // Y sí debe traer exactamente la metadata pedida.
    assert.equal(entry.context.type, "payment");
    assert.equal(entry.context.action, "payment.created");
    assert.equal(entry.context.dataIdFromQuery, "987654321");
    assert.equal(entry.context.dataIdFromBody, "987654321");
    assert.deepEqual(entry.context.queryKeys.sort(), ["action", "data.id", "type"]);
    assert.equal(entry.context.xRequestId, "req-leak-check");
    assert.equal(entry.context.userAgent, "MercadoPago Webhooks/1.0");
    assert.equal(entry.context.contentType, "application/json");
    assert.equal(entry.context.hasSignature, true);
    assert.equal(entry.context.signatureFormatValid, true);
});

// ==================================================================
// signatureFormatValid distingue "header presente pero mal formado" de
// "header con formato ts=/v1= pero valor incorrecto" — ambos terminan en
// firma inválida, pero el diagnóstico debe poder distinguirlos.
// ==================================================================
test("signatureFormatValid is false when x-signature is present but malformed (no ts/v1)", async () => {
    const req = fakeReq({ headers: { "x-signature": malformedSignatureHeader() } });
    const { res } = fakeRes();

    const calls = await withWarnSpy(async (calls) => {
        await handleMercadoPagoWebhook(req, res);
        return calls;
    });

    const entry = calls.find((c) => c.message === "mercadopago webhook: firma inválida");
    assert.ok(entry);
    assert.equal(entry.context.hasSignature, true);
    assert.equal(entry.context.signatureFormatValid, false);
});

// ==================================================================
// 5) Una firma válida continúa funcionando exactamente igual — probado por
// inspección estática: el código posterior a la rama modificada (chequeo
// DATA_ID_MISMATCH, el llamado al service, y las respuestas 200/500) no
// cambió ni una línea. Combinado con mercadoPagoWebhookSignature.test.js
// (11 tests, sin tocar — verifyMercadoPagoWebhookSignature no se modificó,
// sólo se exportó parseXSignatureHeader, que antes era privada), esto
// cubre el requisito sin ejecutar el service real.
// ==================================================================
test("5) the valid-signature continuation path is byte-for-byte unchanged by this diagnostic-logging change", () => {
    const source = readFileSync(controllerPath, "utf8");
    assert.ok(source.includes('logger.warn("mercadopago webhook: data.id de query y de body no coinciden");'));
    assert.ok(source.includes('return res.status(401).json({ received: false, error: "DATA_ID_MISMATCH" });'));
    assert.ok(source.includes("const outcome = await processMercadoPagoWebhookNotification({ type, dataId, bodyUserId });"));
    assert.ok(source.includes('return res.status(500).json({ received: true, action: outcome.action });'));
    assert.ok(source.includes('return res.status(200).json({ received: true, action: outcome.action });'));

    // La rama de firma inválida sigue devolviendo exactamente el mismo
    // shape que antes de este cambio — el logging extra no altera el
    // response.
    assert.ok(source.includes('return res.status(401).json({ received: false, error: "INVALID_SIGNATURE" });'));
});

// ==================================================================
// 6) MISSING_SIGNATURE mantiene su comportamiento actual — rama sin tocar.
// ==================================================================
test("6) a completely missing x-signature header still responds 401 MISSING_SIGNATURE, with the original unmodified log (no new metadata)", async () => {
    const req = fakeReq({ headers: {} });
    const { res, state } = fakeRes();

    const calls = await withWarnSpy(async (calls) => {
        await handleMercadoPagoWebhook(req, res);
        return calls;
    });

    assert.equal(state.statusCode, 401);
    assert.deepEqual(state.jsonBody, { received: false, error: "MISSING_SIGNATURE" });

    const entry = calls.find((c) => c.message === "mercadopago webhook: falta el header x-signature");
    assert.ok(entry, "esperaba el log original de header ausente, sin cambios");
    assert.equal(entry.context, undefined, "esta rama no se tocó — no debe tener metadata nueva");

    // Nunca debe haber disparado, en este caso, el log NUEVO de firma
    // inválida (son ramas distintas).
    assert.ok(!calls.some((c) => c.message === "mercadopago webhook: firma inválida"));
});

// ==================================================================
// Auditoría "endurecer webhook" — 7) log único de entrada: un solo
// logger.info al comienzo del controller, con metadata segura, nunca
// x-signature/v1/secret/tokens.
// ==================================================================
test("7) the single entry log fires for every request with safe correlation metadata, never leaking x-signature/secret/tokens", async () => {
    const configuredSecret = "diagnostics-test-secret-xyz";
    const xSignature = wellFormedButWrongSignatureHeader({
        dataId: "555000111",
        requestId: "req-entry-log",
        ts: "1710000000",
        secret: "wrong-secret-not-the-configured-one",
    });
    const req = fakeReq({
        headers: {
            "x-signature": xSignature,
            "x-request-id": "req-entry-log",
            "user-agent": "MercadoPago Webhooks/1.0",
            "content-type": "application/json",
        },
        query: { "data.id": "555000111", type: "payment" },
        body: { data: { id: "555000111" }, type: "payment", action: "payment.updated" },
    });
    const { res } = fakeRes();

    const calls = await withInfoSpy(async (calls) => {
        await handleMercadoPagoWebhook(req, res);
        return calls;
    });

    const entry = calls.find((c) => c.message === "mercadopago webhook: recibido");
    assert.ok(entry, "esperaba el log único de entrada");
    const serialized = JSON.stringify(entry);
    assert.ok(!serialized.includes(xSignature), "el log de entrada no debe incluir el header x-signature completo");
    assert.ok(!serialized.toLowerCase().includes(configuredSecret.toLowerCase()), "el log de entrada no debe incluir el secret");
    assert.ok(!serialized.toLowerCase().includes("access_token"));
    assert.ok(!serialized.toLowerCase().includes("refresh_token"));

    assert.equal(entry.context.xRequestId, "req-entry-log");
    assert.equal(entry.context.type, "payment");
    assert.equal(entry.context.action, "payment.updated");
    assert.equal(entry.context.dataIdFromQuery, "555000111");
    assert.equal(entry.context.dataIdFromBody, "555000111");
    assert.deepEqual(entry.context.queryKeys.sort(), ["data.id", "type"]);
    assert.equal(entry.context.userAgent, "MercadoPago Webhooks/1.0");
    assert.equal(entry.context.contentType, "application/json");
    assert.equal(entry.context.format, "webhook_v2");
});

// ==================================================================
// Auditoría "endurecer webhook" — 8/9) IPN legado (?id=...&topic=...,
// sin x-signature): se reconoce explícitamente, nunca llega al service,
// nunca es tratado como "firma inválida", ack 200 deliberado.
// ==================================================================
test("8) legacy IPN format (?id=...&topic=payment) is recognized explicitly, acked 200 with ignored_legacy_ipn, and never reaches the service", async () => {
    const source = readFileSync(controllerPath, "utf8");
    const legacyBranchIndex = source.indexOf('if (format === "ipn_legacy")');
    const serviceCallIndex = source.indexOf("processMercadoPagoWebhookNotification({");
    assert.ok(legacyBranchIndex !== -1, "no encontré la rama de IPN legado en el controller");
    assert.ok(
        legacyBranchIndex < serviceCallIndex,
        "la rama de IPN legado debe aparecer, en el código fuente, antes del único llamado al service"
    );

    const req = fakeReq({
        headers: { "user-agent": "MercadoPago Feed v2.0 payment" },
        query: { id: "123456", topic: "payment" },
    });
    const { res, state } = fakeRes();

    const calls = await withInfoSpy(async (calls) => {
        await handleMercadoPagoWebhook(req, res);
        return calls;
    });

    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.jsonBody, { received: true, action: "ignored_legacy_ipn" });

    const entry = calls.find((c) => c.message === "mercadopago webhook: formato IPN legado detectado — no soportado, se descarta sin procesar");
    assert.ok(entry, "esperaba el log explícito de IPN legado");
    assert.equal(entry.context.topic, "payment");
    assert.equal(entry.context.legacyId, "123456");
    assert.equal(entry.context.userAgent, "MercadoPago Feed v2.0 payment");

    // Nunca se lo confunde con firma inválida — son ramas y logs distintos.
    assert.ok(!calls.some((c) => c.message === "mercadopago webhook: firma inválida"));
});

test("9) legacy IPN format for merchant_order is also recognized explicitly and acked 200 without ever processing a Sale", async () => {
    const req = fakeReq({
        headers: { "user-agent": "MercadoPago Feed v2.0 merchant_order" },
        query: { id: "999999", topic: "merchant_order" },
    });
    const { res, state } = fakeRes();

    const calls = await withInfoSpy(async (calls) => {
        await handleMercadoPagoWebhook(req, res);
        return calls;
    });

    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.jsonBody, { received: true, action: "ignored_legacy_ipn" });
    const entry = calls.find((c) => c.message === "mercadopago webhook: formato IPN legado detectado — no soportado, se descarta sin procesar");
    assert.ok(entry);
    assert.equal(entry.context.topic, "merchant_order");
});

test("a modern Webhooks v2 request is never misclassified as legacy IPN, even if it happens to also carry topic/id", async () => {
    const xSignature = wellFormedButWrongSignatureHeader({
        dataId: "777",
        requestId: "req-mixed",
        ts: "1710000001",
        secret: "wrong-secret",
    });
    const req = fakeReq({
        headers: { "x-signature": xSignature, "x-request-id": "req-mixed" },
        // A propósito trae AMBOS: data.id/type (moderno) y topic/id
        // (legado) — el moderno debe ganar siempre.
        query: { "data.id": "777", type: "payment", topic: "payment", id: "777" },
    });
    const { res, state } = fakeRes();

    await withWarnSpy(async () => {
        await withInfoSpy(async () => {
            await handleMercadoPagoWebhook(req, res);
        });
    });

    // Firma inválida (no es MISSING/ignored_legacy_ipn) confirma que pasó
    // por el camino Webhooks v2, no por el de IPN legado.
    assert.equal(state.statusCode, 401);
    assert.deepEqual(state.jsonBody, { received: false, error: "INVALID_SIGNATURE" });
});

// ==================================================================
// Auditoría "endurecer webhook" — 10) catch genérico con más contexto
// (paymentId/x-request-id/type/formato) — verificado por inspección
// estática, mismo criterio que el test 5: nunca se ejecuta el service
// real en este archivo (evita tocar Prisma).
// ==================================================================
test("10) the generic catch block logs paymentId/x-request-id/type/format context, never a fabricated saleId", () => {
    const source = readFileSync(controllerPath, "utf8");
    const serviceCallIndex = source.indexOf("processMercadoPagoWebhookNotification({");
    const catchIndex = source.indexOf("} catch (error) {", serviceCallIndex);
    assert.ok(serviceCallIndex !== -1 && catchIndex !== -1, "no encontré el catch genérico después del llamado al service");

    const catchBlock = source.slice(catchIndex);
    assert.ok(catchBlock.includes("logger.error(appError, {"), "el catch genérico debe seguir logueando con logger.error");
    assert.ok(catchBlock.includes("xRequestId,"), "el catch genérico debe incluir x-request-id");
    assert.ok(catchBlock.includes("type,"), "el catch genérico debe incluir type");
    assert.ok(catchBlock.includes("format,"), "el catch genérico debe incluir el formato detectado");
    assert.ok(
        catchBlock.includes("paymentId: dataIdFromQuery ?? bodyDataId ?? null,"),
        "el catch genérico debe incluir paymentId, resuelto sin queries adicionales"
    );
    assert.ok(
        !catchBlock.includes("saleId:"),
        "el catch genérico no debe inventar un campo saleId que no tiene forma segura de conocer (la palabra puede aparecer en un comentario explicando por qué no se agrega, eso es intencional)"
    );
    assert.ok(
        catchBlock.includes('return res.status(500).json({ received: true, action: "internal_error" });'),
        "la respuesta 500 del catch genérico no debe cambiar"
    );
});
