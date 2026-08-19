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
