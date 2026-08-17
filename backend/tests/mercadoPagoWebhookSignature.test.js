import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyMercadoPagoWebhookSignature, getMercadoPagoWebhookSecret } from "../src/config/mercadoPagoWebhookSignature.js";

// MP-3 — validación de firma en aislamiento, sin DB. El algoritmo (manifest
// "id:<lowercase>;request-id:<..>;ts:<..>;" + HMAC-SHA256 hex) está
// verificado contra la documentación oficial y el propio ejemplo del SDK
// (ver mercadoPagoWebhookSignature.js) — estos tests reproducen el
// algoritmo de forma independiente (no importan la misma función que
// arma el manifest) para no poder "hacer trampa" probando la función
// contra sí misma.

const SECRET = "test-webhook-secret";

function realSignature({ dataId, requestId, ts, secret = SECRET }) {
    let manifest = "";
    if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    return { header: `ts=${ts},v1=${v1}`, v1, manifest };
}

test("getMercadoPagoWebhookSecret throws a clear error when MERCADOPAGO_WEBHOOK_SECRET is not configured yet", () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    assert.throws(() => getMercadoPagoWebhookSecret(), /Falta configurar la variable de entorno MERCADOPAGO_WEBHOOK_SECRET/);
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "restored-for-later-tests";
});

test("a correctly computed signature is accepted", () => {
    const ts = "1704908010";
    const { header } = realSignature({ dataId: "123456789", requestId: "req-abc-1", ts });
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: header,
        xRequestId: "req-abc-1",
        dataId: "123456789",
        secret: SECRET,
    });
    assert.equal(valid, true);
});

test("data.id is lowercased before signing/verifying — an uppercase dataId still matches", () => {
    const ts = "1704908010";
    // La firma real se calculó sobre la versión en minúsculas del id.
    const { header } = realSignature({ dataId: "abc123", requestId: "req-1", ts });
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: header,
        xRequestId: "req-1",
        dataId: "ABC123", // el caller puede mandarlo en cualquier casing
        secret: SECRET,
    });
    assert.equal(valid, true);
});

test("a tampered v1 value is rejected", () => {
    const ts = "1704908010";
    const { v1 } = realSignature({ dataId: "123456789", requestId: "req-abc-1", ts });
    const tampered = v1.slice(0, -1) + (v1.at(-1) === "0" ? "1" : "0");
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=${tampered}`,
        xRequestId: "req-abc-1",
        dataId: "123456789",
        secret: SECRET,
    });
    assert.equal(valid, false);
});

test("a signature computed with the WRONG secret is rejected", () => {
    const ts = "1704908010";
    const { header } = realSignature({ dataId: "123456789", requestId: "req-abc-1", ts, secret: "wrong-secret" });
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: header,
        xRequestId: "req-abc-1",
        dataId: "123456789",
        secret: SECRET,
    });
    assert.equal(valid, false);
});

test("a payload with a different dataId than the one that was signed is rejected", () => {
    const ts = "1704908010";
    const { header } = realSignature({ dataId: "123456789", requestId: "req-abc-1", ts });
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: header,
        xRequestId: "req-abc-1",
        dataId: "999999999", // distinto al firmado
        secret: SECRET,
    });
    assert.equal(valid, false);
});

test("a different x-request-id than the one that was signed is rejected", () => {
    const ts = "1704908010";
    const { header } = realSignature({ dataId: "123456789", requestId: "req-abc-1", ts });
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: header,
        xRequestId: "req-DIFFERENT",
        dataId: "123456789",
        secret: SECRET,
    });
    assert.equal(valid, false);
});

test("a missing x-signature header is rejected without throwing", () => {
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: undefined,
        xRequestId: "req-abc-1",
        dataId: "123456789",
        secret: SECRET,
    });
    assert.equal(valid, false);
});

test("a malformed x-signature header (missing ts or v1) is rejected without throwing", () => {
    assert.equal(
        verifyMercadoPagoWebhookSignature({ xSignature: "v1=onlyv1", xRequestId: "r", dataId: "1", secret: SECRET }),
        false
    );
    assert.equal(
        verifyMercadoPagoWebhookSignature({ xSignature: "ts=123", xRequestId: "r", dataId: "1", secret: SECRET }),
        false
    );
    assert.equal(
        verifyMercadoPagoWebhookSignature({ xSignature: "garbage-not-even-kv-pairs", xRequestId: "r", dataId: "1", secret: SECRET }),
        false
    );
});

test("a non-hex v1 value never throws, just fails validation", () => {
    const ts = "1704908010";
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=not-hex-at-all-zzzz`,
        xRequestId: "req-abc-1",
        dataId: "123456789",
        secret: SECRET,
    });
    assert.equal(valid, false);
});

// La documentación indica que si data.id o x-request-id faltan, esa parte
// se OMITE del manifest en vez de dejar "id:;" — se prueba que el manifest
// omitido también valida correctamente cuando el emisor real hizo lo mismo.
test("when x-request-id is absent, the manifest omits that segment entirely — still validates", () => {
    const ts = "1704908010";
    const { header } = realSignature({ dataId: "123456789", requestId: undefined, ts });
    const valid = verifyMercadoPagoWebhookSignature({
        xSignature: header,
        xRequestId: undefined,
        dataId: "123456789",
        secret: SECRET,
    });
    assert.equal(valid, true);
});
