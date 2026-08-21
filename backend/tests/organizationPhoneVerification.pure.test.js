import test from "node:test";
import assert from "node:assert/strict";
import {
    isOrganizationPhoneConfirmationText,
    requiresEmailAuthorization,
} from "../src/services/organizationPhoneVerification.service.js";

// Verificación de teléfono/WhatsApp de Organización — lógica PURA (nunca
// toca la base), corre segura bajo `npm run test:unit` aunque el módulo
// importe prisma.js transitivamente (mismo criterio que
// withdrawalRequest.pure.test.js).

test("isOrganizationPhoneConfirmationText accepts the exact word, case-insensitive", () => {
    assert.equal(isOrganizationPhoneConfirmationText("CONFIRMAR"), true);
    assert.equal(isOrganizationPhoneConfirmationText("confirmar"), true);
    assert.equal(isOrganizationPhoneConfirmationText("Confirmar"), true);
    assert.equal(isOrganizationPhoneConfirmationText("CoNfIrMaR"), true);
});

test("isOrganizationPhoneConfirmationText tolerates surrounding/repeated whitespace", () => {
    assert.equal(isOrganizationPhoneConfirmationText("  confirmar  "), true);
    assert.equal(isOrganizationPhoneConfirmationText("confirmar\n"), true);
});

test("isOrganizationPhoneConfirmationText rejects anything that is not exactly the word", () => {
    assert.equal(isOrganizationPhoneConfirmationText("confirmar por favor"), false);
    assert.equal(isOrganizationPhoneConfirmationText("si, confirmo"), false);
    assert.equal(isOrganizationPhoneConfirmationText("confirmado"), false);
    assert.equal(isOrganizationPhoneConfirmationText("CONFIRMAR!"), false);
    assert.equal(isOrganizationPhoneConfirmationText(""), false);
    assert.equal(isOrganizationPhoneConfirmationText(null), false);
    assert.equal(isOrganizationPhoneConfirmationText(undefined), false);
    assert.equal(isOrganizationPhoneConfirmationText(123456), false);
});

test("requiresEmailAuthorization is true only when the organization already has a verified phone", () => {
    assert.equal(requiresEmailAuthorization({ phoneVerifiedAt: new Date() }), true);
    assert.equal(requiresEmailAuthorization({ phoneVerifiedAt: null }), false);
    assert.equal(requiresEmailAuthorization({ phoneVerifiedAt: undefined }), false);
    assert.equal(requiresEmailAuthorization({}), false);
    assert.equal(requiresEmailAuthorization(null), false);
});
