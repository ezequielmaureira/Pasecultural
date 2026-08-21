import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseXHubSignatureHeader, verifyWhatsappWebhookSignature } from "../src/config/whatsappWebhookSignature.js";

// Validación de autenticidad del webhook de WhatsApp/Meta — lógica PURA,
// mismo criterio que mercadoPagoWebhookSignature.test.js (si existe) para
// MP-3: nunca hace ningún request real, nunca toca la base.

const SECRET = "test-app-secret";

function realSignatureFor(rawBody, secret = SECRET) {
    return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

test("parseXHubSignatureHeader extracts the hex digest from a well-formed sha256= header", () => {
    assert.equal(parseXHubSignatureHeader("sha256=abcd1234"), "abcd1234");
});

test("parseXHubSignatureHeader rejects malformed/missing headers", () => {
    assert.equal(parseXHubSignatureHeader(""), null);
    assert.equal(parseXHubSignatureHeader(null), null);
    assert.equal(parseXHubSignatureHeader(undefined), null);
    assert.equal(parseXHubSignatureHeader("sha1=abcd1234"), null);
    assert.equal(parseXHubSignatureHeader("not-a-header"), null);
});

test("verifyWhatsappWebhookSignature: true for a signature computed over the exact raw body with the right secret", () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: "1" }] }));
    const signatureHeader = realSignatureFor(rawBody);
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader, rawBody, secret: SECRET }), true);
});

test("verifyWhatsappWebhookSignature: false if a single byte of the body changes (tamper detection)", () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: "1" }] }));
    const signatureHeader = realSignatureFor(rawBody);
    const tamperedBody = Buffer.from(JSON.stringify({ entry: [{ id: "2" }] }));
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader, rawBody: tamperedBody, secret: SECRET }), false);
});

test("verifyWhatsappWebhookSignature: false with the wrong secret", () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [] }));
    const signatureHeader = realSignatureFor(rawBody, "wrong-secret");
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader, rawBody, secret: SECRET }), false);
});

test("verifyWhatsappWebhookSignature: false when the header, rawBody, or secret is missing — never throws", () => {
    const rawBody = Buffer.from("{}");
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader: null, rawBody, secret: SECRET }), false);
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader: realSignatureFor(rawBody), rawBody: null, secret: SECRET }), false);
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader: realSignatureFor(rawBody), rawBody, secret: null }), false);
});

test("verifyWhatsappWebhookSignature: false for a garbage/non-hex signature — never throws", () => {
    const rawBody = Buffer.from("{}");
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader: "sha256=not-hex-at-all-zz", rawBody, secret: SECRET }), false);
});

test("verifyWhatsappWebhookSignature: a forged/guessed signature never matches", () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: "1" }] }));
    const forged = "sha256=" + "0".repeat(64);
    assert.equal(verifyWhatsappWebhookSignature({ signatureHeader: forged, rawBody, secret: SECRET }), false);
});
