import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsappOutboundRecipient } from "../src/services/whatsapp.service.js";

// Fase 2D.1 — normalizeWhatsappOutboundRecipient es pura (recibe el flag
// de test mode como booleano explícito, nunca lee process.env), así que
// estos tests no necesitan mockear nada.

// A) argentino con "9" de móvil + test mode habilitado -> se quita el "9".
test("normalizeWhatsappOutboundRecipient strips the mobile 9 for an Argentine number when test mode is enabled", () => {
    assert.equal(normalizeWhatsappOutboundRecipient("5492984405532", true), "542984405532");
});

// B) argentino sin el "9" -> ya está en la forma esperada, no cambia.
test("normalizeWhatsappOutboundRecipient leaves an already-normalized Argentine number unchanged", () => {
    assert.equal(normalizeWhatsappOutboundRecipient("542984405532", true), "542984405532");
});

// C) otro país -> nunca se toca, aunque test mode esté habilitado (no
// matchea el patrón 549 + 10 dígitos).
test("normalizeWhatsappOutboundRecipient leaves a non-Argentine number unchanged", () => {
    assert.equal(normalizeWhatsappOutboundRecipient("12025550123", true), "12025550123");
});

// D) test mode deshabilitado -> nunca transforma, ni siquiera un argentino con "9".
test("normalizeWhatsappOutboundRecipient leaves the number unchanged when test mode is disabled", () => {
    assert.equal(normalizeWhatsappOutboundRecipient("5492984405532", false), "5492984405532");
});

test("normalizeWhatsappOutboundRecipient returns non-string input unchanged", () => {
    assert.equal(normalizeWhatsappOutboundRecipient(null, true), null);
    assert.equal(normalizeWhatsappOutboundRecipient(undefined, true), undefined);
});
