import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWebhookVerification } from "../src/services/whatsapp.service.js";
import { receiveWhatsappWebhook } from "../src/controllers/whatsapp.controller.js";

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
