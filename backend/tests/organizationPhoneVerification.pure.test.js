import test from "node:test";
import assert from "node:assert/strict";
import {
    parseOrganizationPhoneConfirmationMessage,
    requiresEmailAuthorization,
    buildOrganizationPhoneVerificationDeepLink,
} from "../src/services/organizationPhoneVerification.service.js";

// Verificación de teléfono/WhatsApp de Organización — lógica PURA (nunca
// toca la base), corre segura bajo `npm run test:unit` aunque el módulo
// importe prisma.js transitivamente (mismo criterio que
// withdrawalRequest.pure.test.js).

test("parseOrganizationPhoneConfirmationMessage accepts CONFIRMAR + token, case-insensitive, tolerating surrounding/repeated whitespace", () => {
    assert.deepEqual(parseOrganizationPhoneConfirmationMessage("CONFIRMAR ABC123XYZ9"), { token: "ABC123XYZ9" });
    assert.deepEqual(parseOrganizationPhoneConfirmationMessage("confirmar abc123xyz9"), { token: "ABC123XYZ9" });
    assert.deepEqual(parseOrganizationPhoneConfirmationMessage("  Confirmar   ABC123XYZ9  "), { token: "ABC123XYZ9" });
    assert.deepEqual(parseOrganizationPhoneConfirmationMessage("CoNfIrMaR\nABC123XYZ9"), { token: "ABC123XYZ9" });
});

test("parseOrganizationPhoneConfirmationMessage rejects a bare CONFIRMAR with no token", () => {
    assert.equal(parseOrganizationPhoneConfirmationMessage("CONFIRMAR"), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage("  confirmar  "), null);
});

test("parseOrganizationPhoneConfirmationMessage rejects partial matches and extra text", () => {
    assert.equal(parseOrganizationPhoneConfirmationMessage("confirmar por favor ABC123"), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage("si, confirmo ABC123"), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage("confirmado ABC123"), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage("CONFIRMAR ABC123 gracias"), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage("CONFIRMAR!ABC123"), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage(""), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage(null), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage(undefined), null);
    assert.equal(parseOrganizationPhoneConfirmationMessage(123456), null);
});

test("requiresEmailAuthorization is true only when the organization already has a verified phone", () => {
    assert.equal(requiresEmailAuthorization({ phoneVerifiedAt: new Date() }), true);
    assert.equal(requiresEmailAuthorization({ phoneVerifiedAt: null }), false);
    assert.equal(requiresEmailAuthorization({ phoneVerifiedAt: undefined }), false);
    assert.equal(requiresEmailAuthorization({}), false);
    assert.equal(requiresEmailAuthorization(null), false);
});

test("buildOrganizationPhoneVerificationDeepLink builds a wa.me URL with CONFIRMAR + token prefilled and URL-encoded", () => {
    const url = buildOrganizationPhoneVerificationDeepLink("5493511234567", "ABC123XYZ9");
    assert.equal(url, "https://wa.me/5493511234567?text=CONFIRMAR%20ABC123XYZ9");
});
