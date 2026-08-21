import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeReason, sanitizeReasonNote, buildOrganizationContact } from "../src/services/withdrawalRequest.service.js";

// Botón de arrepentimiento — lógica PURA (nunca toca la base), corre segura
// bajo `npm run test:unit` aunque el módulo importe prisma.js
// transitivamente (mismo criterio ya establecido con serviceFee.service.test.js
// y developerAlertConfig.service.test.js: ninguna query se ejecuta acá).

test("sanitizeReason accepts every valid enum value", () => {
    for (const reason of ["ARREPENTIMIENTO", "ERROR_COMPRA", "CAMBIO_EVENTO", "PROBLEMA_ENTRADAS", "OTRO"]) {
        assert.equal(sanitizeReason(reason), reason);
    }
});

test("sanitizeReason returns null for undefined/null/empty (optional field)", () => {
    assert.equal(sanitizeReason(undefined), null);
    assert.equal(sanitizeReason(null), null);
    assert.equal(sanitizeReason(""), null);
});

test("sanitizeReason rejects an unrecognized value instead of silently storing it", () => {
    assert.throws(() => sanitizeReason("REEMBOLSO_GARANTIZADO"), (err) => {
        assert.equal(err.code, "WITHDRAWAL_REQUEST_NOT_ELIGIBLE");
        return true;
    });
});

test("sanitizeReasonNote trims and returns null for empty/whitespace-only text", () => {
    assert.equal(sanitizeReasonNote("   "), null);
    assert.equal(sanitizeReasonNote(""), null);
    assert.equal(sanitizeReasonNote(undefined), null);
    assert.equal(sanitizeReasonNote(null), null);
    assert.equal(sanitizeReasonNote("  hola  "), "hola");
});

test("sanitizeReasonNote caps length at 500 characters — never an unbounded free-text field", () => {
    const long = "a".repeat(600);
    const sanitized = sanitizeReasonNote(long);
    assert.equal(sanitized.length, 500);
});

test("buildOrganizationContact builds a wa.me link when the phone parses as a real Argentine number", () => {
    const contact = buildOrganizationContact({ phone: "+54 9 351 412-3456", email: "org@example.com" }, "Mi Evento");
    assert.ok(contact.whatsappUrl.startsWith("https://wa.me/549351"));
    assert.ok(contact.whatsappUrl.includes(encodeURIComponent("Mi Evento")));
});

test("buildOrganizationContact never includes DNI, OTP, tokens, or other-purchase data in the prearmed message", () => {
    const contact = buildOrganizationContact({ phone: "+54 9 351 412-3456", email: "org@example.com" }, "Mi Evento");
    const decoded = decodeURIComponent(contact.whatsappUrl);
    for (const forbidden of ["dni", "otp", "token", "codigo", "código"]) {
        assert.ok(!decoded.toLowerCase().includes(forbidden), `the prearmed WhatsApp message must never mention "${forbidden}"`);
    }
});

test("buildOrganizationContact falls back to the organization's public email when the phone can't be parsed with certainty", () => {
    const contact = buildOrganizationContact({ phone: "no-es-un-telefono", email: "org@example.com" }, "Mi Evento");
    assert.equal(contact.whatsappUrl, null);
    assert.equal(contact.email, "org@example.com");
});

test("buildOrganizationContact falls back to null email when the organization phone AND some hypothetical missing email — never invents a contact", () => {
    const contact = buildOrganizationContact({ phone: null, email: null }, "Mi Evento");
    assert.equal(contact.whatsappUrl, null);
    assert.equal(contact.email, null);
});
